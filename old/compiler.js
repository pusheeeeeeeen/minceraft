class Compiler {
  constructor(code) {
    this.lexer = new Lexer(code)
    this.parser = new Parser(this.lexer)
  }

  static namespace = "zzz__compiler__"
  namespace = Compiler.namespace

  varStorage = `${this.namespace}:vars`
  tempStorage = `${this.namespace}:temp`

  run() {
    this.lexer.tokenize()

    let ast = this.parser.parse()

    console.log("%c" + JSON.stringify(ast, null, 2), "font-family: Menlo, monospace; font-size: 11px;")

    return this.compile(ast)
  }

  compile(ast) {
    this.functions = {}
    this.id = 0
    this.literalTypes = {}
    this.env = new Environment()

    let varSetup = setupDefaultVars(this)

    let fullLoadFn = `${SETUP}\n${varSetup.join("\n")}\n${this.compileBlock(ast)}`

    this.registerFunction(`${this.namespace}:_load`, fullLoadFn)

    return this.functions
  }

  nextId() {
    return (this.id++).toString(36)
  }

  registerFunction(name, data) {
    this.functions[name] = data
  }

  registerInternalFunction(data) {
    let id = `${this.namespace}:${this.nextId()}`

    this.registerFunction(id, data)

    return id
  }

  registerObject(str) {
    let id = this.nextId()

    return {
      id,
      str : `data modify storage ${this.varStorage} ${id} set value ${str}`
    }
  }

  registeredObjectPath(id) {
    return `${this.varStorage} ${id}`
  }

  compileBlock(ast) {
    let parentEnv = this.env
    this.env = new Environment(parentEnv)

    let {functions, remainingAST} = this.declareFunctions(ast)

    for (let i of functions)
      this.registerInternalFunction(i)

    let statements = remainingAST.flatMap(x => {
      let result = this.compileStatement(x)

      if (!result)
        return []
      else if (typeof result === "string")
        return [result]
      else
        return result
    })

    this.env.warnUnused()

    this.env = parentEnv

    if (statements.length === 1)
      return statements[0]

    return `function ${this.registerInternalFunction(statements.join("\n"))}`
  }

  declareFunctions(ast) {
    let functions = [], remainingAST = []

    for (let statement of ast) {
      if (statement.type === "function")
        functions.push(this.compileFunction(statement))
      else
        remainingAST.push(statement)
    }

    return {functions, remainingAST}
  }

  compileFunction(ast) {

  }

  compileStatement(ast) {
    if (ast.type === "variable")
      return this.compileVariable(ast)
    else if (ast.type === "print")
      return this.compilePrint(ast)
    else if (ast.type === "if")
      return this.compileIf(ast)
    else
      throw new Error(`Uncompilable statement type '${ast.type}'`)
  }

  compileVariable(ast) {
    if (this.env.getSelf(ast.name))
      throw new error.DefinitionError(`Cannot create duplicate variable '${ast.name}'`)

    let expr = this.compileExpression(ast.value)

    let id = this.nextId()

    this.env.register(ast.name, {
      type : ast.dataType,
      const : ast.const,
      id
    })

    this.checkImplicitCast(expr.type, ast.dataType)

    return this.storeExpression(expr, this.varStorage, id)
  }

  compilePrint(ast) {
    let expr = this.compileExpression(ast.value)

    if (expr.type.type === "class")
      return `tellraw @a "<class ${expr.type.className}>"`

    return [
      ...this.storeExpression(expr, this.tempStorage, "_expr"),
      `tellraw @a {"storage": "${this.tempStorage}", "nbt": "_expr.value"}`
    ]
  }

  compileIf(ast) {
    // TODO optimize && by chaining 'if's
    // TODO optimize ! by using 'unless'
    // TODO optimize !(a || b) by using (!a && !b) instead + above optimizations

    let condition = this.compileExpression(ast.condition)

    this.checkImplicitCast(condition.type, {type : "bool"})

    let commands = [
      ...this.storeExpressionIntoScoreboard(condition, this.namespace, "temp"),
      `execute if score temp ${this.namespace} matches 1 run ${this.compileBlock(ast.body)}`
    ]

    if (ast.else)
      commands.push(
        `execute unless score temp ${this.namespace} matches 1 run ${this.compileBlock(ast.else)}`
      )

    return commands
  }

  registerClass(name, staticProps, staticMethods, instanceProps, instanceMethods, superclass = null) {
    if (staticProps.__instance__ || staticMethods.__instance__)
      throw new error.DefinitionError("Class static method/field name '__instance__' is reserved")

    if (staticProps.new || staticMethods.new)
      throw new error.DefinitionError("Class static method/field name 'new' is reserved")

    if (instanceProps.constructor || staticProps.constructor)
      throw new error.DefinitionError("Class method/field name 'constructor' is reserved")

    let classId = this.nextId(),
        instanceId = this.nextId()

    let obj = {
      type : {type : "class", className : name},
      const : true,
      id : classId,
      classData : {
        props : staticProps,
        methods : staticMethods,
        instance : {
          type : {type : "proto", className : name},
          const : true,
          id : instanceId,
          classData : {
            props : instanceProps,
            methods : instanceMethods,
            super : superclass && superclass.classData.instance
          }
        },
        super : superclass,
      }
    }

    staticProps.__instance__ = obj.classData.instance
    instanceProps.constructor = obj

    if (superclass) {
      staticProps.__super__ = obj.classData.super
      instanceProps.__super__ = obj.classData.instance.super
    }

    this.env.register(name, obj)

    return {
      obj,
      str : [
        ...this.storeExpression(
          {str : `value ${this.literalCompound("class")}`},
          this.varStorage,
          classId
        ),
        ...this.storeExpression(
          {str : `value ${this.literalCompound("proto")}`},
          this.varStorage,
          instanceId
        )
      ]
    }
  }

  compileClass(ast) {
    // TODO
  }

  literalCompound(type, value = null, extra = {}) {
    extra.type ||= `"${type}"`
    return this.objectCompound(value, extra)
  }

  objectCompound(value, extra = {}) {
    if (value) extra.value = value
    return this.stringifyCompound(extra)
  }

  stringifyCompound(obj) {
    return `{${Object.entries(obj).map(item => item.join(": ")).join(", ")}}`
  }

  compileLiteral(ast) {
    if (ast.type === "string")
      return {
        type : {type : "string"},
        str : this.literalCompound("string", `"${ast.value}"`)
      }
    else if (ast.type === "number")
      return {
        type : {type : ast.dataType},
        str : this.literalCompound(ast.dataType, `${ast.value}${ast.letterType}`)
      }
    else if (ast.type === "bool")
      return {
        type : {type : "bool"},
        str : this.literalCompound("bool", ast.value ? "1b" : "0b")
      }
    else if (ast.type === "null")
      return {
        type : {type : "null"},
        str : this.literalCompound("null")
      }
  }

  LITERAL_EXPR_TYPES = new Set(["string", "number", "bool", "null"])

  compileExpression(ast) {
    if (this.LITERAL_EXPR_TYPES.has(ast.type)) {
      let literal = this.compileLiteral(ast)

      return {
        str : `value ${literal.str}`,
        type : literal.type
      }
    } else if (ast.type === "reference") {
      let ref = this.env.get(ast.value)

      if (!ref)
        throw new error.ReferenceError(`Variable '${ast.value}' does not exist`)

      return {
        str : `from storage ${this.varStorage} ${ref.id}`,
        type : ref.type,
        classData : ref.classData
      }
    } else if (ast.type === "list")
      return this.compileList(ast)
    else if (ast.type === "hash")
      return this.compileHash(ast)
    else if (ast.type === "operation")
      return this.compileOperation(ast)
    else
      throw new Error(`Uncompilable expression type '${ast.type}'`)
  }

  /*

  +   +=
  -   -=
  *   *=
  /   /=
  %   %=
  **  **=
  =   ==
  !   !=
  &   &=
  |   |=
  ^   ^=
  <   <=
  >   >=
  &&  &&=
  ||  ||=
  ??  ??=
  <<  <<=
  >>  >>=
  ..  ..=
  .
  :
  ? :
  [
  (

  */

  compileOperation(ast) {
    let left = ast.left && this.compileExpression(ast.left)

    if (ast.operator === ".") {
      if (ast.right.type !== "reference")
        throw new error.SyntaxError("Right side of dot operator must be an identifier")

      let prop = ast.right.value

      let leftType = this.getPropertyContainer(left),
          result = this.env.getProp(leftType, prop)

      if (!result)
        throw new error.ReferenceError(`Unknown property '${this.stringifyTypeInstance(left.type)}.${prop}'`)

      // let id = this.nextId()

      return {
        str : `${this.varStorage} ${result.id}`,
        // extra : this.storeExpression(left, this.tempStorage, id),
        type : result.type,
        classData : result.classData
      }
    } else if (ast.operator === "!") {
      let right = this.compileExpression(ast.right)

      if (!this.canImplicitCast(right.type, {type : "bool"}))
        throw new error.TypeError(`Expected boolean expression after logical not operator ('!'), but found expression of type '${this.stringifyType(right.type)}' instead`)

      let id = this.nextId()

      return {
        str : `from storage ${this.tempStorage} ${id}`,
        extra : [
          ...this.storeExpression(right, this.tempStorage, id),
          `execute store success storage ${this.tempStorage} ${id}.value byte 1 run data modify storage ${this.tempStorage} ${id}.value set value 1b`
        ],
        type : {type : "bool"}
      }
    } else
      throw new Error(`Operator '${ast.operator}' is not yet implemented`)
  }

  getPropertyContainer(expr) {
    if (expr.type.list)
      throw new Error("List expressions are not yet implemented")

    let literalType = expr.type.type

    if (expr.classData)
      return expr.classData
    else if (this.literalTypes[literalType])
      return this.literalTypes[literalType].classData.instance.classData
    else
      throw new Error(`Cannot access properties of expression type '${this.stringifyType(expr.type)}'`)
  }

  // compileReferenceExpression(ast) {
  //   if (ast.type === "reference") {
  //     let ref = this.env.get(ast.value)
  //
  //     if (!ref)
  //       throw new error.ReferenceError(`Variable '${ast.value}' does not exist`)
  //
  //     return {
  //       type : ref.type,
  //       str : `${this.varStorage} ${ref.id}`
  //     }
  //   } else
  //     throw new error.SyntaxError("Left side of expression is not a reference")
  // }

  compileList(ast) {
    if (!ast.items.length)
      return {
        str : "[]", // TODO fix
        type : {
          type : "unknown",
          list : true
        }
      }

    if (this.LITERAL_EXPR_TYPES.has(ast.items[0].type)) {
      let types = new Set(ast.items.map(x => x.type))

      if (types.size > 1)
        throw new error.TypeError(`Cannot create list of mixed types`)

      let items = ast.items.map(item => this.compileLiteral(item))

      return {
        str : `value [${items.map(item => item.str).join()}]`, // TODO fix
        type : {
          ...items[0].type,
          list : true
        }
      }
    } else {
      let items = ast.items.map(item => this.compileExpression(item))

      for (let i = 0; i < items.length - 1; i++) {
        let typeA = items[i].type,
          typeB = items[i + 1].type

        if (!this.canImplicitCast(typeB, typeA))
          throw new error.TypeError(`Cannot create list of mixed types (${this.stringifyType(typeA)} and ${this.stringifyType(typeB)})`)
      }

      let id = this.nextId(),
          extra = [`data modify storage ${this.tempStorage} ${id} set value ${this.literalCompound("list", "[]", {of : `"${items[0].type}"`})}`] // TODO fix

      for (let i of items)
        extra.push(...this.customStoreExpression(i, `data modify storage ${this.tempStorage} ${id}.value append`))

      return {
        str : `from storage ${this.tempStorage} ${id}`,
        extra,
        type : {
          ...items[0].type,
          list : true
        }
      }
    }
  }

  compileHash(ast) {
    let keys = Object.keys(ast.items)

    if (!keys.length)
      return {
        str : this.literalCompound("hash", "{}"), // TODO fix
        type : {type : "hash"}
      }

    let id = this.nextId(),
        extra = [`data modify storage ${this.tempStorage} ${id} set value ${this.literalCompound("hash", "{}")}`] // TODO fix

    for (let i in ast.items)
      extra.push(...this.customStoreExpression(
        this.compileExpression(ast.items[i]),
        `data modify storage ${this.tempStorage} ${id}.value.${i} set value`
      ))

    return {
      str : `from storage ${this.tempStorage} ${id}`,
      extra,
      type : {type : "hash"}
    }
  }

  customStoreExpression(expr, str) {
    if (expr.type?.type === "proto")
      throw new error.TypeError("Cannot store instance prototypes (<Class>.__instance__) in variables; you must access their properties directly")

    let extra = typeof expr.extra === "string" ? [expr.extra] : expr.extra || []

    return [
      ...extra,
      `${str} ${expr.str}`
    ]
  }

  storeExpression(expr, namespace, path) {
    return this.customStoreExpression(expr, `data modify storage ${namespace} ${path} set`)
  }

  storeExpressionIntoScoreboard(expr, objective, player) {
    return [
      ...this.storeExpression(expr, this.tempStorage, "_expr"),
      this.transferToScoreboard(this.tempStorage, "_expr.value", player, objective)
    ]
  }

  transferToScoreboard(namespace, path, player, objective) {
    return `execute store result score ${player} ${objective} run data get storage ${namespace} ${path}`
  }

  compileExpressionAndStore(ast, namespace, path) {
    return this.storeExpression(this.compileExpression(ast), namespace, path)
  }

  compileExpressionIntoScoreboard(ast, objective, player) {
    return this.storeExpressionIntoScoreboard(this.compileExpression(ast), objective, player)
  }

  stringifyType(type) {
    let mainType = type.type

    if (!mainType) {
      let json = JSON.stringify(type)

      // show error message after any other error messages
      setTimeout(() => consoleError("Error", `Cannot stringify type ${json}`))

      return json
    }

    return mainType + (type.list ? "[]" : "")
  }

  stringifyTypeInstance(type) {
    if (type.type === "class" && type.className)
      return type.className
    else if (type.type === "proto" && type.className)
      return `<${type.className} prototype>`
    else if (type.type === "instance" && type.className)
      return `<${type.className} instance>`
    else
      return this.stringifyType(type)
  }

  checkImplicitCast(from, to) {
    if (to && !this.canImplicitCast(from, to))
      throw new error.TypeError(`Cannot implicitly cast type '${this.stringifyType(from)}' to type '${this.stringifyType(to)}'`)
  }

  canImplicitCast(from, to) {
    if (from.list !== to.list) return false

    return from.type === "unknown"
      || from.type === to.type
      || from.type === "null" && to.type === "hash"
  }
}

const SETUP = `
scoreboard objectives add ${Compiler.namespace} dummy
`.trim()
