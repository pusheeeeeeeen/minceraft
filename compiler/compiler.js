/** @type Compiler */
let compiler
let names = {}

function idGenerator(onlyDigits = false) {
  let i = 0

  return () => (i++).toString(onlyDigits ? 10 : 36)
}

class Compiler {
  static joinSeparateBefore(strings, ...inserts) {
    let before = []

    let str = strings.map((s, i) => {
      if (i >= inserts.length) return s

      let insert = inserts[i]
      if (insert instanceof CompiledExpression) {
        if (insert.options.before) {
          before.push(...insert.options.before)
        }
        return s + insert.str
      } else return s + insert
    }).join("")

    return [before, str]
  }

  static joinToSubcommandObj(...args) {
    let [before, str] = this.joinSeparateBefore(...args)
    return { str, options: { before } }
  }

  static join(...args) {
    let [before, str] = this.joinSeparateBefore(...args)
    before.push(str)
    return before
  }

  ////////////////////////////////

  constructor(code, name) {
    this.lexer = new Lexer(code)
    this.parser = new Parser(this.lexer)

    this.name = name
  }

  run() {
    compiler = this

    let name = this.name.replace(/\W/g, "").toLowerCase(),
        namespace = `zzz_compiled_${name}`

    /*

    STACK:
    NS:s {
      s: [
        {
          _a: [ ...<args>... ],
          <var_id>: <var_value>,
          ...
        },
        ...
      ]
    }

    HEAP:
    NS:h {
      <object_id>: {
        _n: "Name",
        <field_id>: <field_value>,
        ...
      },
      ...
    }

    MACRO ARGUMENTS:
    NS:m {
      p: <curr_pointer>,
      i: <array_access_index>
    }

    CLASS DATA:
    NS:c {
      _c: [ <class_data>, ... ],
      // TODO maybe?:
      // <static_field_id>: <static_field_value>,
      // ...
    }

    MISC:
    NS:x {
      t: <temp>,
      r: <function_return_val>
      a: [ <array_init_data> ],
      ba: [B; ?]
    }

    SCOREBOARD NAMESPACES:
    _t, _u - temp
    _p - pointer counter
    _o - overflow, 0 = running, 1 = finished
    _f - return reason, 1 = return, 2 = break, 3 = error

    */

    // TODO use library path as namespace for functions, objects, etc.

    names = {
      name,
      namespace,
      stackStorage: `${namespace}:s`,
      stackStoragePath: `${namespace}:s s`,
      heapStorage: `${namespace}:h`,
      macroStorage: `${namespace}:m`,
      classDataStorage: `${namespace}:c`,
      classDataStoragePath: `${namespace}:c _c`,
      miscStorage: `${namespace}:x`,
      scoreboard: namespace,
      tempScoreboardName: "_t",
      tempScoreboardName2: "_u",
      pointerScoreboard: `_p ${namespace}`,
      returnFlagScoreboard: `_r ${namespace}`
    }

    this.lexer.tokenize()
    let ast = this.parser.parse()

    let astStr = JSON.stringify(ast, null, 2).replace(/"(\w+?)":/g, "$1:")
    console.log("%c" + astStr, "font-family: Menlo, monospace; font-size: 11px;")

    return this.compile(ast)
  }

  processGenerics(generics) {
    let restIndex = null

    generics.forEach((generic, i) => {
      generic.explicitExtends = !!generic.extends
      generic.explicitDefault = !!generic.default

      if (generic.extends?.isFinal()) {
        consoleWarn(`Generic '${generic.name}' only has one possible value because there are no other types that extend '${generic.extends.asString()}'`)
      }

      if (generic.rest) {
        // TODO copy errors in parser and change these to 'problem'
        if (restIndex !== null) {
          throw new error.SyntaxError(`Can only have one rest generic per type definition (found '...${generics[restIndex].name}' and '...${generic.name}')`)
        } else if (generic.default) {
          throw new error.SyntaxError(`Rest generic '...${generic.name}' cannot have a default value`)
        }

        if (!generic.extends) {
          generic.extends = new ClassType(this.lang.Array)
        } else if (!generic.extends.is(this.lang.Array)) {
          throw new error.TypeDefinitionError(`Rest generic '...${generic.name}' must extend Array (found 'extends ${generic.extends.asString()}' instead)`)
        }

        restIndex = i
      } else {
        generic.extends ||= Type.unknown()
        // TODO implicit default for generics should really be `? extends <extendsType>`
        //      which needs to happen at usage site, not declaration
        generic.default ||= generic.extends
      }
    })

    return {
      generics,
      restIndex,
      maxGenerics: restIndex !== null ? Infinity : generics.length
    }
  }

  assignGenerics(cl, generics) {
    cl = cl.value

    if (!cl.maxGenerics) {
      if (generics.length) {
        throw new error.TypeDefinitionError(`Class '${cl.name}' does not support generics, but generics were found on type '${cl.name}${Type.stringifyGenerics(generics)}'`)
      }
      return []
    }

    if (generics.length > cl.maxGenerics) {
      throw new error.TypeDefinitionError(`Too many generics in type '${cl.name}${Type.stringifyGenerics(generics)}', expected at most ${cl.maxGenerics}`)
    }

    let variadicSpread = null
    let expandedGenerics = generics.flatMap(generic => {
      if (generic instanceof Type) return generic

      let { type, spread } = generic
      if (!spread) return type

      // for generic types that extend a nullable type, don't use this error message
      // the error will be caught by the next check below instead
      if (type.nullable && !(type instanceof AnyType) && (!(type instanceof GenericType) || type.hasNullableModifier)) {
        throw new error.TypeDefinitionError(`Spread generic '...${type.asString()}' must not be nullable`)
      // TODO really this should be any type that has some intersection with any[] or never[]
      //      probably actually anything that implements `abstract Iterable`
      } else if (!type.is(this.lang.Array, false, [new AnyType()])) {
        if (type instanceof GenericType) {
          throw new error.TypeDefinitionError(`Invalid spread generic '...${type.asString()}'. Generic '${type.asDefinitionString()}' does not extend Array`)
        } else {
          throw new error.TypeDefinitionError(`Invalid spread generic '...${type.asString()}', not a subtype of Array`)
        }
      }

      if (type instanceof TupleType) {
        if (!type.variadic) return type.leftTypes
        return type._flattenedCache ||= [
          ...type.leftTypes,
          { type: type.middleTypeUnion, variadicSpread: true }
          // ...type.rightTypes TODO add back when rightTypes is reinstated
        ]
      } else {
        variadicSpread ||= type
        return { type, variadicSpread: true }
      }
    })

    if (variadicSpread && expandedGenerics.length < cl.generics.length) {
      throw new error.TypeDefinitionError(`Spread generic of indeterminate length '...${variadicSpread.asString()}' is only valid if all generics are explicitly specified`)
    }

    let restOffset = Math.max(-1, expandedGenerics.length - cl.generics.length),
        seenRest = false

    return cl.generics.map((target, i) => {
      if (target.rest) {
        if (seenRest) throw new Error(`Encountered more than one rest generic on class '${cl.name}'`)
        seenRest = true

        let generics = expandedGenerics.slice(i, i + restOffset + 1)

        if (generics.some(x => x.variadicSpread)) {
          if (generics.length > 1) {
            // TODO use variadic tuples
            return new ClassType(this.lang.Array, false, [
              new UnionType(generics.map(x => x.variadicSpread ? x.type : x))
            ])
          } else return generics[0].type
        } else return new TupleType(generics, false, Type.unknown())
      }

      let generic = expandedGenerics[i + (seenRest ? restOffset : 0)]
      if (generic?.variadicSpread) {
        throw new error.TypeDefinitionError(`Spread generic of indeterminate length '...${generic.type.asString()}' must align with ...rest generic`)
      }
      return generic || target.default
    })
  }

  createClass(name, superclass, generics, final = false, literalTypeName = null) {
    let superGenerics = []
    if (superclass?.class) {
      superGenerics = superclass.generics
      superclass = superclass.class
    }

    if (superclass) {
      if (superclass.type.instanceOf !== this.lang.Class) {
        throw new Error(`Superclass parameter of 'createClass()' must be a class (${name})`)
      } else if (superclass === this.lang.Class) {
        throw new error.ClassError("Classes cannot extend 'Class' metaclass")
      }
    }

    // TODO type check superclass generics, etc.

    return new Value(
      new ClassType(this.lang.Class),
      {
        id: this.id.class(),
        name,
        superclass,
        superGenerics,
        ...this.processGenerics(generics),
        depth: superclass ? superclass.value.depth + 1 : 0, // TODO maybe remove?
        final,
        literalTypeName
      }
    )
  }

  registerClass(name, superclass, generics, final = false, env = null, literalTypeName = null) {
    env ||= this.env

    let cl = this.createClass(name, superclass, generics, final, literalTypeName)

    env.registerVar(name, null, cl, true)
    env.registerClassType(literalTypeName || name, cl)
    if (literalTypeName) this.literalTypeClasses[literalTypeName] = cl

    return cl
  }

  propKey(name) {
    // cannot start with _
    return NBT.key(name.startsWith("#") ? "-" + name.slice(1) : "+" + name)
  }

  setClassFields(cl, staticProps, instanceProps) {
    cl.value.staticProps = Object.setPrototypeOf(staticProps, null)
    cl.value.instanceProps = Object.setPrototypeOf(instanceProps, null)

    let classData = { _n: cl.value.name }
    let before = []

    for (let name in staticProps) {
      let prop = staticProps[name]

      let key = this.id.staticProp()
      prop.key = key

      if (prop.expr) {
        let loc = DataLocation.storage(names.classDataStorage, key)
        let [lines, expr] = prop.expr.intoStorage(loc, true)
        before.push(...lines)
        prop.getExpr = expr.withType(prop.type)
      } else if (prop.value) {
        prop.getExpr = new Expression(prop.type, { compileTimeValue: prop.value })
      } else {
        throw new Error("Static property with neither .expr nor .value")
      }
    }
    for (let name in instanceProps) {
      let prop = instanceProps[name]
      let override = cl.superclass?.value.instanceProps[name]

      let hasValue = prop.expr || prop.value

      if (override && override.access !== Access.PRIVATE) {
        prop.key = override.key
        prop.root = override // TODO needs to be Set of roots if multiple inheritance/interfaces is implemented

        if (override.final) {
          throw new error.ClassError(`Property '${this.stringifyProp(prop, false)}' of subclass ${cl.value.name} cannot override 'final' property of the same name from superclass ${cl.superclass.value.name}`)
        }

        let errors = []
        if (prop.access < override.access) {
          errors.push("Cannot override with weaker access privileges")
        }
        if (prop.writable !== override.writable) {
          // TODO better error message for methods
          errors.push("Properties must either be both constant or both writable")
        }
        if (prop.shared !== override.shared) {
          // TODO better error message for methods
          errors.push("Properties must either be both shared or both non-shared")
        }
        let validType = prop.writable ? !prop.type || prop.type.isEquivalentTo(override.type) : prop.type.isSubtypeOf(override.type)
        if (!validType) {
          // TODO better error message for methods
          errors.push(prop.writable ? "Non-const overrides must match overridden type exactly (or omit explicit type)" : "Overriding type must be assignable to overridden property")
        }

        if (errors.length) {
          let msg = `Incompatible override between '${this.stringifyProp(prop, false)}' of subclass ${cl.value.name} and '${this.stringifyProp(override, false)}' of superclass ${cl.superclass.value.name}. `
          throw new error.ClassError(msg + errors.join("; "))
        }

        if (!prop.type) prop.type = override.type
        if (!prop.value && prop.access === override.access) {
          consoleWarn(`Pointless override; property '${this.stringifyProp(prop, false)}' (overrides ${this.stringifyProp(override, false)}) has no effect`)
        }
      } else {
        // valid for overrides since they can inherit the type
        if (!prop.type && !hasValue) {
          throw new error.TypeError("Class field declarations must either have a value or a type (unless overriding)")
        }

        prop.key = this.propKey(name)
        prop.root = prop
      }

      if (prop.shared) {
        if (prop.expr) {
          if (prop.expr.isCompileTime()) {
            classData[prop.key] = prop.expr.values.compileTimeValue.asSNBT()
          } else {
            // TODO something something superclass
            let loc = this.instanceFieldLoc(prop.key, true, cl.id)
            let [lines, expr] = prop.expr.intoStorage(loc, true)
            before.push(...lines)
            prop.getExpr = expr.withType(prop.type)
          }
        } else if (prop.value) {
          classData[prop.key] = prop.value.asSNBT()
          prop.getExpr = new Expression(prop.type, { compileTimeValue: prop.value })
        } else {
          throw new Error("Shared property with neither .expr nor .value")
        }
      }
    }

    this.classData[cl.value.id] = NBT.stringifyInlineStrings(classData)
    return before
  }

  stringifyProp(prop, isStatic) {
    let parts
    if (prop.shared && !prop.writable && prop.type.isFunction()) {
      parts = [
        isStatic ? "static " : null,
        prop.final ? "final " : null,
        prop.access === Access.PROTECTED ? "#" : null,
        prop.name,
        prop.type.paramTypes.length ? "(...)" : "()",
        ": ",
        prop.type.returnType.asString()
      ]
    } else {
      parts = [
        isStatic ? "static " : null,
        prop.final ? "final " : null,
        prop.shared ? "shared " : null,
        !prop.writable ? "const " : null,
        prop.access === Access.PROTECTED ? "#" : null,
        prop.name,
        ": ",
        prop.type.asString()
      ]
    }
    return parts.filter(Boolean).join("")
  }

  ////////////////////////////////

  FUNCTION_MACRO_REGEX = /\$\([a-z0-9_]+\)/i

  internalFunctionId() {
    return `${names.namespace}:${this.id.func()}`
  }

  registerFunction(lines, id = null) {
    let fullID
    if (id?.includes(":")) {
      fullID = id
    } else {
      fullID = `${names.namespace}:${id || this.id.func()}`
    }

    // TODO super jank macro detection but not necessarily incorrect as long as they are always escaped in strings
    lines = lines.map(line => this.FUNCTION_MACRO_REGEX.test(line) ? "$" + line : line)
    this.functions[fullID] = lines.join("\n")
    return fullID
  }

  addTickingFunction(id) {
    this.tickingFunctions.add(id)
  }

  registerFunctionAsString(lines, id = null, handlers = undefined) {
    return this.functionCommand(this.registerFunction(lines, id || ""), handlers)
  }

  returnFlags = { NONE: 0, RETURN: 1, BREAK: 2, THROW: 3 }

  setReturnFlags(flag) {
    return `scoreboard players set ${names.returnFlagScoreboard} ${flag}`
  }

  functionCommand(id, options = undefined) {
    return this.handleReturnFlagsFromIfBranch(`if function ${id}`, options) || `function ${id}`
  }

  // str should be 'function <id> [...]'
  fullFunctionCommand(str, options = undefined) {
    let handleFlags = this.handleReturnFlagsFromIfBranch(`unless score ${this.tempScoreboardLoc} matches 0`, options)
    if (!handleFlags) return [str]

    return [
      `scoreboard players set ${this.tempScoreboardLoc} 0`, // void return value - see https://minecraft.wiki/w//function/#:~:text=void
      `execute store result score ${this.tempScoreboardLoc} run ${str}`,
      handleFlags
    ]
  }

  // if the branch succeeds, then return flags are processed
  // this aligns with function calls if the branch is `if function <id>`, as functions
  // should return a non-zero value to signal a return/break/throw
  handleReturnFlagsFromIfBranch(branch, {
    // defaults if an object is passed:
    handleReturn = !!this.functionContext,
    handleBreak = true,
    handleThrow = true
    // default to false if no arg is passed
  } = { handleReturn: false, handleBreak: false, handleThrow: false }) {
    let count = handleReturn + handleBreak + handleThrow

    switch (count) {
      case 0:
        return null
      case 1:
        let flag1 = handleReturn ? this.returnFlags.RETURN : handleBreak ? this.returnFlags.BREAK : this.returnFlags.THROW
        return `execute ${branch} if score ${names.returnFlagScoreboard} matches ${flag1} run ${this.earlyReturn()}`
      case 2:
        let flag2 = !handleReturn ? this.returnFlags.RETURN : !handleBreak ? this.returnFlags.BREAK : this.returnFlags.THROW
        return `execute ${branch} unless score ${names.returnFlagScoreboard} matches ${flag2} run ${this.earlyReturn()}`
      case 3:
        return `execute ${branch} run ${this.earlyReturn()}`
      default:
        throw new Error("Invalid count of enabled return flag handlers")
    }
  }

  compileFunctionCall(expr, args, implicitThis = false) {
    let { type, compileTimeValue } = expr

    if (!type.isFunction()) {
      throw new error.TypeError(`Called expressions must be of function type (found '${type.asString()}' instead)`)
    }

    let targetCount = type.paramTypes.length
    if (args.length < targetCount) {
      // TODO "at least" if rest
      throw new error.TypeError(`Not enough arguments passed to function (expected ${targetCount - implicitThis}, got ${args.length - implicitThis})`)
    }
    if (args.length > targetCount) {
      // TODO rest
      throw new error.TypeError(`Too many arguments passed to function (expected ${targetCount - implicitThis}, got ${args.length - implicitThis})`)
    }

    let argTuple = new TupleType(args.map(arg => arg.type))
    if (!argTuple.isSubtypeOf(type.paramTuple)) {
      if (implicitThis) {
        let expected = type.paramTuple.typeAt(0), got = args[0].type
        if (!got.isSubtypeOf(expected)) {
          throw new Error(`Implicit this value was of wrong type (expected ${expected.asString()}, got ${got.asString()})`)
        }
      }

      // TODO better error message
      let expected = `(${type.paramTuple.asString().slice(1, -1)})`, got = `(${argTuple.asString().slice(1, -1)})`
      throw new error.TypeError(`Incorrect argument types passed to function (expected ${expected}, got ${got})`)
    }

    // TODO re-enable JS func inlining?
    // if (compileTimeValue?.func) {
    //   let before = args.flatMap(arg => arg.getSideEffects())
    //   return compileTimeValue.func(args.map(arg => arg.withoutSideEffects()))
    //                          .withType(type.returnType)
    //                          .withSideEffects(before, true)
    // }

    let runtimeBefore = [], runtimeAfter = []
    let snbt = args.map((arg, i) => {
      if (arg.isCompileTime()) {
        return arg.values.compileTimeValue.asSNBT()
      }

      let [before, permanent] = arg.asPermanent()
      runtimeBefore.push(before)
      runtimeAfter.push(permanent.intoStorage(this.functionArgLoc(true, i), true)[0])
      return "0b"
    })

    return new Expression(type.returnType, {
      storage: {
        location: compiler.functionReturnLoc,
        options: {
          temporary: true,
          before: concat(
            runtimeBefore,
            `data modify ${this.functionArgLoc(true)} set value ${NBT.stringifyInlineStrings(snbt)}`,
            runtimeAfter,
            ...this.callFunctionExpression(expr)
          )
        }
      }
    })
  }

  callFunctionExpression(expr, handleReturnFlags = true) {
    let flags = handleReturnFlags ? { handleReturn: false } : undefined

    if (expr.compileTimeValue?.id) {
      return [compiler.functionCommand(expr.compileTimeValue.id, flags)]
    } else {
      let id = this.dynamicDispatchId ||= this.registerFunction([
        "return run function $(v)"
      ], "_dyn")

      let [before, func] = Compiler.joinSeparateBefore`function ${id} with ${expr.asDataString()}`
      return concat(before, compiler.fullFunctionCommand(func, flags))
    }
  }

  compileFunctionFromJS(func, type) {
    let args = type.paramTypes

    let returnVal = func(args.map((type, i) => new Expression(type, {
      storage: { location: this.functionArgLoc(true, i) }
    })))

    return type.returnType instanceof VoidType
      ? returnVal.getSideEffects()
      : returnVal.intoStorage(this.functionReturnLoc, true)[0]
  }

  ////////////////////////////////

  loadFuncBefore() {
    return [
      `gamerule max_command_sequence_length ${NUMBER_RANGES.int.max}`,
      `gamerule max_command_forks ${NUMBER_RANGES.int.max}`,
      `data modify storage ${names.stackStoragePath} set value [{}]`,
      `scoreboard objectives add ${names.scoreboard} dummy`,
      `scoreboard players set ${names.pointerScoreboard} 0`,
      `data modify ${this.byteArrayLoc} set value [B;0]`
    ]
  }

  entryPointBefore() {
    return [
      `execute if score _o ${names.scoreboard} matches 0 run ${this.hitChainLimitErrorFunction}`,
      `scoreboard players set _o ${names.scoreboard} 0`
    ]
  }

  entryPointAfter() {
    return [
      `scoreboard players set _o ${names.scoreboard} 1`
    ]
  }

  setClassData(classData) {
    return [
      "# INITIALIZE CLASS DATA",
      `data modify storage ${names.classDataStoragePath} set value [\\\n  ${classData.join(",\\\n  ")}\\\n]`
    ]
  }

  compilerDirectives = null

  compile(ast) {
    this.id = {
      class: idGenerator(true),
      staticProp: idGenerator(),
      stack: idGenerator(),
      scoreboard: idGenerator(),
      func: idGenerator(),
      dynamicGetFunc: idGenerator(),
      anonGeneric: idGenerator(true)
    }

    this.tempStorageLoc = DataLocation.storage(names.miscStorage, "t")

    this.tempScoreboardLoc = this.scoreboardLoc(names.tempScoreboardName)
    this.tempScoreboardLoc2 = this.scoreboardLoc(names.tempScoreboardName2)

    this.functionReturnLoc = DataLocation.storage(names.miscStorage, "r")
    this.byteArrayLoc = DataLocation.storage(names.miscStorage, "ba")

    this.env = new Environment()

    this.functions = {}

    this.tickingFunctions = new Set()

    this.hitChainLimitErrorFunction = this.registerFunctionAsString([
      `tellraw @a {text:"The previous function hit the maximum chain length limit.",color:"red"}`,
      `execute store result score _o ${names.scoreboard} run gamerule max_command_sequence_length`,
      `execute unless score _o ${names.scoreboard} matches ${NUMBER_RANGES.int.max} run tellraw @a {text:"The max_command_sequence_length gamerule has been lowered since the datapack was loaded. Make sure this gamerule stays at the maximum value.",color:"red"}`,
      `execute store result score _o ${names.scoreboard} run gamerule max_command_forks`,
      `execute unless score _o ${names.scoreboard} matches ${NUMBER_RANGES.int.max} run tellraw @a {text:"The max_command_forks gamerule has been lowered since the datapack was loaded. Make sure this gamerule stays at the maximum value.",color:"red"}`
    ], "_overflow")

    this.literalTypeClasses = {}
    this.lang = {}
    this.langGenerics = {}
    this.classData = []

    let defaultsSetupLines = setupDefaults(this)
    setupCompDirectives(this)

    let mainFunc = this.registerFunctionAsString(this.compileBlock(ast, {
      global: true,
      functionContext: { noRecurse: true },
      advanceStack: false
    }), "_main")

    this.registerFunction([
      ...this.loadFuncBefore(),
      ...this.setClassData(this.classData),
      ...defaultsSetupLines,
      ...this.entryPointBefore(),
      mainFunc,
      ...this.entryPointAfter()
    ], "_load")

    return {
      functions: this.functions,
      tickingFunctions: this.tickingFunctions
    }
  }

  storageLoc(id = null) {
    return DataLocation.storage(names.stackStorage, `s[-1].${id ?? this.id.stack()}`)
  }

  scoreboardLoc(name = null) {
    return DataLocation.score(names.scoreboard, name ?? this.id.scoreboard())
  }

  instanceFieldLoc(key, shared = false, pointer = null) {
    return shared
      ? DataLocation.storage(names.classDataStorage, `_c[${pointer || "$(t)"}].${key}`)
      : DataLocation.storage(names.heapStorage, `${pointer || "$(v)"}.${key}`)
  }

  functionArgLoc(outsideScope, index = null) {
    return DataLocation.storage(names.stackStorage, `s[${outsideScope ? -1 : -2}]._a${index !== null ? `[${index}]` : ""}`)
  }

  #tempArrayDataLoc
  tempArrayDataLoc(index = null) {
    return index !== null
      ? DataLocation.storage(names.miscStorage, `a[${index}]`)
      : this.#tempArrayDataLoc ||= DataLocation.storage(names.miscStorage, "a")
  }

  newEnv(advanceStack) {
    this.env = new Environment(this.env, advanceStack ? this.globalEnv : this.env)
  }

  oldEnv() {
    this.env = this.env.compileTimeParent
  }

  asSingleLine(lines) {
    if (!lines?.length) return null
    if (typeof lines === "string") return lines
    return lines.length > 1 ? this.registerFunctionAsString(lines, null, {}) : lines[0]
  }

  earlyReturnRun(line) {
    let returnCmd = this.earlyReturn()

    return returnCmd === "return 1"
      ? [`return run ${line}`]
      : [line, returnCmd]
  }

  earlyReturn() {
    return this.currentFuncHasScope ? `return run data remove storage ${names.stackStoragePath}[-1]` : "return 1"
  }

  functionContext = null
  currentFuncHasScope = false

  compileBlock(statements, { global = false, functionContext = null, advanceStack = !!functionContext, vars = {}, info = null } = {}) {
    // TODO closures (probably like java) - for now just prevent accessing vars outside function scope
    this.newEnv(advanceStack)
    if (global) this.globalEnv = this.env

    let prevFuncContext = this.functionContext
    if (functionContext !== null) this.functionContext = functionContext

    let didHaveScope = this.currentFuncHasScope
    this.currentFuncHasScope = advanceStack

    for (let name in vars) {
      let expr = vars[name]
      this.env.registerVar(name, expr.type, expr)
    }

    let lines
    if (Array.isArray(statements)) {
      lines = statements.flatMap((statement, i) => {
        // TODO this computation of 'lastInFuncFile' doesn't work in the theoretical case where this block is being inlined into another function file
        let result = this.compileStatement(statement, i === statements.length - 1)
        return typeof result === "string" ? result : result ? result.filter(Boolean) : []
      })
    } else {
      // TODO 'lastInFuncFile' could sometimes be true; see above TODO
      lines = this.compileStatement(statements) || []
      if (typeof lines === "string") lines = [lines]
    }

    // this.warnUnusedVars()

    this.functionContext = prevFuncContext
    this.currentFuncHasScope = didHaveScope

    this.oldEnv()
    if (advanceStack) {
      lines.unshift(`data modify storage ${names.stackStoragePath} append value {}`)
      lines.push(`data remove storage ${names.stackStoragePath}[-1]`)
    }

    if (info) lines.unshift(`# ${info}`)

    return lines
  }

  // warnUnusedVars() {
  //   for (let variable of this.env.getOwnUnused()) {
  //     if (variable.class) {
  //       consoleWarn(`Unused class '${variable.name}'`)
  //     } else {
  //       consoleWarn(`Unused variable '${variable.name}: ${variable.type.asString()}'`)
  //     }
  //   }
  // }

  compileStatement(ast, lastInFuncFile = false) {
    switch (ast.type) {
      case "print":    return this.compilePrint(ast)
      case "variable": return this.compileVariable(ast)
      case "if":       return this.compileIf(ast)
      case "while":    return this.compileWhile(ast)
      case "function": return this.compileFunction(ast)
      case "return":   return this.compileReturn(ast, lastInFuncFile)
      case "class":    return this.compileClass(ast)
      case "block":    return this.compileBlock(ast.value)
      case "expression":
        // TODO warn if unnecessary
        return this.compileExpression(ast.value, true).getSideEffects()
      default:
        throw new Error(`Uncompilable statement type '${ast.type}'`)
    }
  }

  ////////////////////////////////

  compilePrint(ast) {
    if (ast.values.length === 1) {
      let expr = this.compileExpression(ast.values[0])
      return expr.isCompileTime() && expr.type.is(this.lang.String)
        ? `tellraw @a ${NBT.stringify(["\"", { text: expr.compileTimeValue, color: "green" }, "\""])}` // match default NBT formatting for now
        : Compiler.join`tellraw @a ${expr.asTextComponent()}`
    }

    let exprs = ast.values.map(ast => this.compileExpression(ast)), before = []
    let textComponent = exprs.map(expr => {
      if (expr.isCompileTime() && expr.type.is(this.lang.String)) {
        return NBT.stringify(["\"", { text: expr.compileTimeValue, color: "green" }, "\""])
      } else {
        let [before1, permanent] = expr.asPermanent()
        let { str, options: { before: before2 } } = permanent.asTextComponent()
        before.push(before1, before2)
        return str
      }
    })

    return concat(
      before,
      `tellraw @a [${textComponent.join('," ",')}]`
    )
  }

  compileVariable(ast) {
    if (this.env.getOwnVar(ast.name)) {
      throw new error.ReferenceError(`Variable name '${ast.name}' is already declared in the current scope`)
    }

    let type = ast.dataType ? this.compileType(ast.dataType, "Variable type cannot be potentially void") : null,
        value = this.compileExpression(ast.value)

    if (type && !value.type.isSubtypeOf(type)) {
      throw new error.TypeError(`Cannot assign value of type '${value.type.asString()}' to variable '${ast.name}: ${type.asString()}'`)
    }

    // TODO remove isPermanent()
    let [before, expression] = value.asPermanent(ast.const)
    this.env.registerVar(ast.name, type, expression, ast.const)
    return before
  }

  compileIf(ast) {
    let condition = this.compileExpression(ast.condition)

    if (!condition.type.is(this.lang.Boolean)) {
      throw new error.TypeError(`If condition must be a boolean (found '${condition.type.asString()}' instead)`)
    }

    if (condition.isCompileTime()) {
      let body = condition.compileTimeValue ? ast.body : ast.else
      return this.compileBlock(body)
    }

    // TODO something like this.isPure(ast.body)
    let doIf = ast.body && (ast.body.length ?? true), doElse = ast.else && (ast.else.length ?? true)

    if (!doIf && !doElse) return null

    // TODO optimize ! in if condition w/ negate
    let negate = false, asScore = condition.asScoreString()

    // TODO chain nested ifs

    if (doIf && doElse) {
      if (asScore.options.temporary) {
        // TODO dont do this if either block doesnt recurse - put into "somewhat temporary" score
        let loc = this.storageLoc()
        return [
          ...Compiler.join`execute if score ${asScore} matches 1 run data modify ${loc} set value 0b`,
          `execute if data ${loc} run ${this.asSingleLine(this.compileBlock(ast.body))}`,
          `execute unless data ${loc} run ${this.asSingleLine(this.compileBlock(ast.else))}`,
        ]
      } else {
        return [
          ...Compiler.join`execute if score ${asScore} matches 1 run ${this.asSingleLine(this.compileBlock(ast.body))}`,
          `execute unless score ${asScore.str} matches 1 run ${this.asSingleLine(this.compileBlock(ast.else))}`
        ]
      }
    }

    let statements = ast.body
    if (!doIf) {
      statements = ast.else
      negate = !negate
    }

    // TODO inline 'if/unless...' subcommand
    return Compiler.join`execute ${negate ? "unless" : "if"} score ${asScore} matches 1 run ${this.asSingleLine(this.compileBlock(statements))}`
  }

  compileWhile(ast) {
    let condition = this.compileExpression(ast.condition)

    if (!condition.type.is(this.lang.Boolean)) {
      throw new error.TypeError(`If condition must be a boolean (found '${condition.type.asString()}' instead)`)
    }

    // TODO optimize ! in while condition w/ negate
    let negate = false, asScore = condition.asScoreString()

    let id = this.internalFunctionId()
    this.registerFunction(concat(
      this.compileStatement(ast.body),
      Compiler.join`execute ${negate ? "unless" : "if"} score ${asScore} matches 1 run ${this.functionCommand(id, {})}`
    ), id)

    if (condition.isCompileTime()) {
      return condition.compileTimeValue ? this.functionCommand(id, { handleBreak: false }) : null
    } else {
      return Compiler.join`execute ${negate ? "unless" : "if"} score ${asScore} matches 1 run ${this.functionCommand(id, { handleBreak: false })}`
    }
  }

  compileFunction(ast) {
    if (this.env.getOwnVar(ast.name)) {
      throw new error.ReferenceError(`Function name '${ast.name}' is already declared in the current scope`)
    }

    let paramNames = ast.params.map(param => param.name)
    let paramTypes = ast.params.map(param => this.compileType(param.dataType, "Function parameters cannot be a (potentially) void type"))
    let returnType = ast.returnType ? this.compileType(ast.returnType) : new VoidType()

    let id = this.internalFunctionId()

    let type = new ClassType(this.lang.Function, false, [...paramTypes, returnType], { paramNames })
    let value = new Value(type, { id })

    this.env.registerVar(ast.name, type, value, true)

    this.registerFunction(this.compileBlock(ast.body, {
      info: `${ast.name}()`,
      functionContext: { returnType },
      vars: Object.fromEntries(paramNames.map((name, i) => [
        name,
        new Expression(paramTypes[i], { storage: { location: this.functionArgLoc(false, i) } })
      ]))
    }), id)
  }

  compileReturn(ast, lastInFuncFile) {
    if (!this.functionContext) {
      throw new Error("Trying to compile return statement with no function context")
    }

    // TODO super janky condition that might also be occasionally wrong
    let pointless = lastInFuncFile && this.currentFuncHasScope, before

    if (ast.value) {
      let expr = this.compileExpression(ast.value)

      let { returnType } = this.functionContext
      if (!expr.type.isSubtypeOf(returnType)) {
        throw new error.TypeError(`Returned value of type '${expr.type.asString()}' is not assignable to function’s declared return type '${returnType.asString()}'`)
      }

      [before] = expr.intoStorage(this.functionReturnLoc, true)
    } else {
      if (pointless) {
        consoleWarn("Pointless return statement (last statement in function with no return value)")
      }

      before = []
    }

    // TODO kinda conflating code statements and mcfunction statements but maybe fine
    if (!pointless) {
      before.push(...this.earlyReturnRun(this.setReturnFlags(this.returnFlags.RETURN)))
    }
    return before
  }

  // TODO temporary - add error messages to throws
  throwNoMessage() {
    return `return run ${this.setReturnFlags(this.returnFlags.THROW)}`
  }

  ////////////////////////////////

  compileClass(ast) {
    // create class

    let superclass = this.lang.Object

    if (ast.superclass) {
      superclass = this.env.getType(ast.superclass)?.class

      if (!superclass) {
        throw new error.ReferenceError(`Unknown class '${ast.superclass}'`)
      }
      if (superclass.value.final) {
        throw new error.ClassError(`Class '${ast.name}' cannot extend 'final' class '${superclass.value.name}'`)
      }
    }

    this.newEnv(false)

    let generics = ast.generics.map(generic => {
      let obj = {
        ...generic,
        extends: generic.extends && this.compileType(generic.extends),
        default: generic.default && this.compileType(generic.default)
      }
      this.env.registerGenericType(generic.name, obj)
      return obj
    })

    // TODO make this happen wayyyy earlier
    let cl = this.registerClass(
      ast.name,
      superclass && { class: superclass, generics: this.compileGenerics(ast.superGenerics) },
      generics,
      false, // TODO ast.final
      this.env.compileTimeParent
    )

    // init properties

    let staticProps = {}, instanceProps = {}, initFunctions = []
    let thisType = new ClassType(cl, false, generics.map(generic => {
      let type = new GenericType(generic)
      return generic.rest ? { spread: true, type } : type
    }))

    for (let prop of ast.props) {
      let data

      if (prop.type === "method") {
        // TODO rest params
        // TODO static functions can access generics (not good)
        let paramNames = prop.params.map(param => param.name)
        let paramTypes = prop.params.map(param => this.compileType(param.dataType, "Method parameters cannot be a (potentially) void type"))
        let returnType = prop.returnType ? this.compileType(prop.returnType) : new VoidType()

        if (!prop.static) {
          paramNames.unshift("this")
          paramTypes.unshift(thisType)
        }

        let type = new ClassType(this.lang.Function, false, [...paramTypes, returnType], { paramNames })

        let id = this.internalFunctionId()

        initFunctions.push(() => this.registerFunction(
          this.compileBlock(prop.body, {
            info: `${prop.static ? "static " : ""}${ast.name}.${prop.name}()`,
            functionContext: { returnType },
            vars: Object.fromEntries(paramNames.map((name, i) => [
              name,
              new Expression(paramTypes[i], { storage: { location: this.functionArgLoc(false, i) } })
            ]))
          }),
          id
        ))

        data = {
          value: new Value(type, { id }),
          type,
          access: Access.PUBLIC, // TODO
          writable: false,
          shared: true
        }
      } else if (prop.type === "field") {
        if (prop.name === "init" || prop.name === "#init") {
          throw new error.ClassError("Class fields cannot be named 'init' (public or private)")
        }

        let expr, type

        if (prop.dataType) {
          type = this.compileType(prop.dataType, "Class fields cannot be of a (potentially) void type")
        }
        if (prop.value) {
          expr = this.compileExpression(prop.value)
          if (type && !expr.type.isSubtypeOf(type)) {
            throw new error.TypeError(`Initial value of type '${expr.type.asString()}' is not assignable to class field '${prop.name}: ${type.asString()}'`)
          }
          type ||= expr.type
        }

        data = {
          expr,
          type,
          access: Access.PUBLIC, // TODO
          writable: prop.writable,
          shared: prop.shared
        }
      } else {
        throw new Error(`Invalid class prop type '${prop.type}'`)
      }

      (prop.static ? staticProps : instanceProps)[prop.name] = data
    }

    let lines = this.setClassFields(cl, staticProps, instanceProps)
    for (let func of initFunctions) func()

    this.oldEnv()

    return lines
  }

  ////////////////////////////////

  LITERAL_TYPE_NAMES = new Set(["byte", "short", "int", "long", "float", "double", "string", "boolean"])

  /** @return {Expression | [Expression, Expression]} */
  compileExpression(ast, allowVoid = false, trackThisContext = false) {
    let expr

    if (this.LITERAL_TYPE_NAMES.has(ast.type)) {
      let value = ast.value ?? null

      if (ast.type === "long") {
        value = BigInt(value)
      } else if (ast.type === "byte" || ast.type === "short" || ast.type === "int") {
        value = Number(value)
      }

      expr = Expression.compileTime(this.literalTypeClasses[ast.type], value)
    } else if (ast.type === "null") {
      expr = Expression.compileTimeNull()
    } else if (ast.type === "reference") {
      expr = this.compileReference(ast)
    } else if (ast.type === "operation") {
      expr = this.compileOperation(ast, trackThisContext)
    } else if (ast.type === "array") {
      expr = this.instantiateArray(this.compileType(ast.dataType), ast.items.map(ast => this.compileExpression(ast)))
    } else if (ast.type === "new") {
      expr = this.compileNew(ast)
    } else if (ast.type === "comp-dir") {
      expr = this.compileCompDir(ast)
    } else {
      throw new Error(`Uncompilable expression type '${ast.type}'`)
    }

    let thisContext = null
    if (trackThisContext && Array.isArray(expr)) {
      [expr, thisContext] = expr
    }

    if (!allowVoid && expr.maybeVoid()) {
      let { type } = expr

      throw new error.TypeError(
        type instanceof VoidType && !type.nullable
          ? "Expression type cannot be 'void'"
          : `Expression type cannot be potentially void (type '${type.asString()}')`
      )
    }

    return trackThisContext ? [expr, thisContext] : expr
  }

  compileReference(ast) {
    let expr = this.env.getVarExpression(ast.value)
    if (!expr) throw new error.ReferenceError(`Unknown variable '${ast.value}'`)

    return expr
  }

  instantiateArray(type, items) {
    for (let expr of items) {
      if (!expr.type.isSubtypeOf(type)) {
        throw new error.TypeError(`Found array item of type '${expr.type.asString()}' which is not assignable to the array literal’s declared type '${type.asString()}'`)
      }
    }

    // if (items.every(expr => expr.compileTimeValue)) {
    //   return Expression.compileTime(this.lang.Array, items.map(expr => expr.values.compileTimeValue), false, [type])
    // }

    // TODO use NBT typed arrays?
    let runtimeBefore = [], runtimeAfter = []
    let snbt = items.map((expr, i) => {
      if (expr.isCompileTime()) {
        return expr.values.compileTimeValue.asSNBT()
      }

      console.log(expr)

      let [before, permanent] = expr.asPermanent()
      runtimeBefore.push(before)
      runtimeAfter.push(permanent.intoStorage(this.tempArrayDataLoc(i), true)[0])
      return "0b"
    })

    console.log({ runtimeBefore, snbt, runtimeAfter })

    return this.instantiateArrayWithBefore(type, concat(
      runtimeBefore,
      `data modify ${this.tempArrayDataLoc()} set value ${NBT.stringifyInlineStrings(snbt)}`,
      runtimeAfter
    ))
  }

  instantiateArrayWithBefore(type, before) {
    if (!this.arrayInitFunc) {
      let lengthPropLoc = this.instanceFieldLoc(this.lang.Array.value.instanceProps.length.key, false, "$(p)")
      this.arrayInitFunc = this.registerFunction([
        `data modify ${this.instanceFieldLoc("_data", false, "$(p)")} set from ${this.tempArrayDataLoc()}`,
        `data modify ${lengthPropLoc} set value ${new ClassType(this.lang.Integer).asSNBT()}`,
        `execute store result ${lengthPropLoc}.v int 1 run data get ${this.tempArrayDataLoc()}`
      ], "_a_i")
    }

    return this.instantiateWithInitFunc(
      new ClassType(this.lang.Array, false, [type]),
      this.arrayInitFunc,
      before
    )
  }

  compileNew(ast) {
    // TODO dont allow init-ing primitives (private constructor?)

    let cl = this.env.getType(ast.name)?.class
    if (!cl) {
      throw new error.ReferenceError(`Unknown class '${ast.name}'`)
    }

    return this.instantiate(
      cl,
      this.compileGenerics(ast.generics),
      ast.args.map(ast => this.compileExpression(ast))
    )
  }

  instantiate(cl, generics, args) {
    if (!cl.value.initFunc) {
      // TODO init superclass
      // TODO keep non-shared instance fields in array to preserve order
      // TODO initialize compile-time fields in single line
      let lines = Object.values(cl.value.instanceProps).flatMap(
        prop => !prop.shared && prop.expr?.intoStorage(this.instanceFieldLoc(prop.key), true)[0] || []
      )

      lines.unshift(`# init ${cl.value.name}`)
      if (!lines.length) lines.push(`data modify storage ${names.heapStorage} $(v) set value {}`)

      cl.value.initFunc = this.registerFunction(lines)
    }

    // TODO call constructor with args

    return this.instantiateWithInitFunc(new ClassType(cl, false, generics), cl.value.initFunc)
  }

  instantiateWithInitFunc(type, initFunc, before = null) {
    let loc = this.storageLoc()

    return new Expression(type, {
      compileTimeValue: new Value(type),
      storage: {
        location: loc,
        options: {
          before: concat(
            before,
            `execute store result storage ${names.macroStorage} p int 1 run scoreboard players add ${names.pointerScoreboard} 1`,
            `data modify ${loc} set value ${type.asSNBT()}`,
            `data modify ${loc}.v set from storage ${names.macroStorage} p`,
            `function ${initFunc} with storage ${names.macroStorage}`
          )
        }
      }
    })
  }

  compileCompDir(ast) {
    let directive = this.compilerDirectives[ast.value], errorString = `#${ast.value}${ast.params ? "()" : ""}`

    if (!directive) {
      throw new error.ReferenceError(`Unknown compiler directive '${errorString}'`)
    }

    if (!ast.params) {
      if (directive.params) {
        let params = directive.minParams === directive.maxParams ? directive.minParams : `${directive.minParams}-${directive.maxParams}`
        throw new error.TypeError(`Compiler directive '${errorString}' must be called as a function (with ${params} arguments).`)
      }

      return directive.func() || Expression.void()
    } else if (!directive.params) {
      throw new error.TypeError(`Compiler directive '${errorString}' is not a function.`)
    }

    if (ast.params.length < directive.minParams || ast.params.length > directive.maxParams) {
      let expectedCount = directive.minParams === directive.maxParams ? directive.minParams : `${directive.minParams}-${directive.maxParams}`
      throw new error.TypeError(`Incorrect number of arguments passed to compiler directive '${errorString}', expected ${expectedCount}.`)
    }

    let params = ast.params.map(ast => this.compileExpression(ast))

    let invalidParamIndex = params.findIndex((param, i) => !param.type.isSubtypeOf(directive.params[i]))
    if (invalidParamIndex !== -1) {
      console.log(params[invalidParamIndex].type, directive.params[invalidParamIndex])
      throw new error.TypeError(`Cannot assign value of type '${params[invalidParamIndex].type.asString()}' to parameter ${invalidParamIndex + 1} of compiler directive '${errorString}' (expected type '${directive.params[invalidParamIndex].asString()}').`)
    }

    return directive.func(...directive.params.map((_, i) => params[i] || Expression.compileTimeNull())) || Expression.void()
  }

  ////////////////////////////////

  compileOperation(ast, trackThisContext = false) {
    let { operator, left: leftAst, right: rightAst } = ast

    // ASSIGNMENT

    if (operator === "=") {
      if (leftAst.type === "reference") {
        let name = leftAst.value, target = this.env.getVar(name)
        if (target.const) {
          throw new error.ReferenceError(`Cannot assign to constant variable '${name}'`)
        }

        let value = this.compileExpression(rightAst)
        return value.setSideEffects(value.intoLocation(this.env.getVarLocation(target), true)[0])
      } else if (leftAst.operator === ".") {
        if (leftAst.right.type !== "reference") {
          throw new error.SyntaxError("Expected a property name after '.'") // TODO move to parser
        }

        let target = this.compileExpression(leftAst.left)
        let value = this.compileExpression(rightAst)

        return value.setSideEffects(this.setProperty(target, leftAst.right.value, value))
      } else if (leftAst.operator === "[") {
        let target = this.compileExpression(leftAst.left), set
        try {
          set = this.getProperty(target, "set")
        } catch (e) {
          if (!(e instanceof BaseError)) throw e
        }

        if (!set?.type.isFunction() || !set.type.isSubtypeOf(
          this.indexedAssignmentImplType ||= new ClassType(this.lang.Function, false, [target.type, new AnyType(), new AnyType(), new VoidType()])
        )) {
          let detail = set ? `found '${set.type.asNamedString("set")}' instead` : "found no property named 'set'"
          throw new error.TypeError(`Cannot use indexed assignment on type '${target.type.asString()}', as it does not implement 'set(this, K, V): void' (${detail})`)
        }

        let key = this.compileExpression(leftAst.extra), keyType = set.type.paramTypeAt(1)
        if (!key.type.isSubtypeOf(keyType)) {
          throw new error.TypeError(`Cannot index expression of type '${target.type.asString()}' with key of type '${key.type.asString()}'. Expected a key assignable to the type '${keyType.asString()}'`)
        }

        let value = this.compileExpression(rightAst), valueType = set.type.paramTypeAt(2)
        if (!value.type.isSubtypeOf(valueType)) {
          throw new error.TypeError(`Cannot assign into expression of type '${target.type.asString()}' with value of type '${value.type.asString()}'. Expected a value assignable to the type '${valueType.asString()}'`)
        }

        return value.setSideEffects(this.compileFunctionCall(set, [target, key, value], true).getSideEffects())
      } else {
        throw new error.SyntaxError("Invalid target for assignment expression")
      }
    }

    // PREFIX

    if (!leftAst) {
      if (operator === "+") {
        return this.compileExpression(rightAst)
      } else if (operator === "-") {
        let expr = this.compileExpression(rightAst)
        if (!["byte", "short", "int", "long"].includes(expr.type.literalTypeName)) {
          throw new error.TypeError("Unary minus operator can only be applied to numbers")
        }
        if (!expr.isCompileTime()) {
          throw new error.UnimplementedError("Unary minus operator can only be applied to compile-time evaluable expressions")
        }
        return new Expression(expr.type, {
          compileTimeValue: new Value(expr.type, -expr.compileTimeValue)
        })
      } else {
        throw new Error(`Unknown prefix operator '${operator}'`)
      }
    }

    let [left, thisContext] = this.compileExpression(leftAst, false, true)

    // LEFT ONLY

    if (operator === ".") {
      if (rightAst.type !== "reference") {
        throw new error.SyntaxError("Expected a property name after '.'") // TODO move to parser
      }

      let name = rightAst.value, value = left.tryGetStaticProp(name)
      if (value) return value // TODO check static–instance name collisions

      // TODO dont replace generics for non-:: function access
      value = this.getProperty(left, name)
      return trackThisContext ? [value, left] : value
    } else if (operator === "[") {
      let get
      try {
        get = this.getProperty(left, "get")
      } catch (e) {
        if (!(e instanceof BaseError)) throw e
      }

      if (!get?.type.isFunction() || !get.type.isSubtypeOf(
        this.indexedAccessImplType ||= new ClassType(this.lang.Function, false, [left.type, new AnyType(), new AnyType()])
      )) {
        let detail = get ? `found '${get.type.asNamedString("get")}' instead` : "found no property named 'get'"
        throw new error.TypeError(`Cannot use indexed access on type '${left.type.asString()}', as it does not implement 'get(this, K): V' (${detail})`)
      }

      let key = this.compileExpression(ast.extra), keyType = get.type.paramTypeAt(1)
      if (!key.type.isSubtypeOf(keyType)) {
        throw new error.TypeError(`Cannot index expression of type '${left.type.asString()}' with key of type '${key.type.asString()}'. Expected a key assignable to the type '${keyType.asString()}'`)
      }

      return this.compileFunctionCall(get, [left, key], true)
    } else if (operator === "(") {
      let args = (ast.extra || []).map(ast => this.compileExpression(ast))
      if (thisContext) args.unshift(thisContext)

      return this.compileFunctionCall(left, args, !!thisContext)
    } else if (operator === ":") {
      return left.withType(this.compileType(ast.extra))
    }

    // TODO fix potential storage location overlap
    let right = this.compileExpression(rightAst)

    // EQUALITY

    if (operator === "==" || operator === "!=") {
      let loc = this.storageLoc()

      let before = concat(
        left.intoStorage(loc, true)[0],
        Compiler.join`execute store success score ${this.tempScoreboardLoc} run data modify ${loc} set ${right.asExtendedDataString()}`
      )

      // TODO treat all number sizes the same
      return new Expression(
        new ClassType(this.lang.Boolean),
        {
          subcommand: {
            str: `${operator === "==" ? "unless" : "if"} score ${this.tempScoreboardLoc} matches 1`,
            success: true,
            options: { temporary: true, before }
          }
        }
      )
    }

    // NUMERICAL

    // TODO compile time eval
    // TODO type checking

    compileTime: if (operator === "+" || operator === "-") {
      if (left.isCompileTime()) [left, right] = [right, left]
      else if (!right.isCompileTime()) break compileTime

      let leftAsScore = left.asScoreString(this.tempScoreboardLoc)

      return new Expression(
        left.type,
        {
          score: {
            location: leftAsScore.location,
            options: {
              temporary: true,
              before: Compiler.join`scoreboard players ${operator === "+" ? "add" : "remove"} ${leftAsScore} ${right.compileTimeValue}`
            }
          }
        }
      )
    }

    let allocLeftLoc = !left.values.storage || left.values.storage.options?.temporary
    let storageLoc = allocLeftLoc ? this.storageLoc() : left.values.storage.location
    let [leftBefore, leftStorage] = left.intoStorage(storageLoc, true)

    let rightAsScore = right.asScoreString()
    let leftLoc = rightAsScore.location.eq(this.tempScoreboardLoc) ? this.tempScoreboardLoc2 : this.tempScoreboardLoc
    let leftAsScore = leftStorage.asScoreString(leftLoc)

    if (this.BASIC_MATH_OPERATORS.has(operator)) {
      return new Expression(
        left.type,
        {
          score: {
            location: leftLoc,
            options: {
              temporary: true,
              before: concat(
                leftBefore,
                rightAsScore.options.before,
                leftAsScore.options.before,
                `scoreboard players operation ${leftAsScore.str} ${operator}= ${rightAsScore.str}`
              )
            }
          }
        }
      )
    } else if (this.COMPARISON_OPERATORS.has(operator)) {
      return new Expression(
        new ClassType(this.lang.Boolean),
        {
          subcommand: {
            str: `if score ${leftAsScore.str} ${operator} ${rightAsScore.str}`,
            success: true,
            options: {
              temporary: true,
              before: concat(
                leftBefore,
                rightAsScore.options.before,
                leftAsScore.options.before
              )
            }
          }
        }
      )
    }

    throw new Error(`Unknown operator '${operator}'`)
  }

  BASIC_MATH_OPERATORS = new Set("+-*/")
  // SWAPPABLE_MATH_OPERATORS = new Set("+*")  TODO consider swap if pure
  COMPARISON_OPERATORS = new Set([">", "<", ">=", "<="])

  dynamicModifyCache = new Map()

  dynamicStorageModify(toStr, fromStr, extended = false) {
    let cacheKey = `${toStr}#${fromStr}`

    if (this.dynamicModifyCache.has(cacheKey)) {
      return this.dynamicModifyCache.get(cacheKey)
    } else {
      let id = this.registerFunction([`data modify ${toStr} set ${extended ? "" : "from "}${fromStr}`], `mod/${this.id.dynamicGetFunc()}`)
      this.dynamicModifyCache.set(cacheKey, id)
      return id
    }
  }

  getProperty(target, name, replaceGenerics = true) {
    let { type } = target

    if (type.nullable) {
      let isNull = type.isNull()
      throw new error.TypeError(`Cannot get properties of ${isNull ? "" : "potentially "}null value (getting '${name}' from expression of type '${type.asString()}')`)
    }

    let propType = type.getPropType(name), values = {}

    let { access, root: { key, shared } } = type.getPropAccessData(name)

    // TODO check property access privilege

    if (target.compileTimeType) {
      let prop = target.values.compileTimeValue.getPropData(name)
      if (!prop) {
        throw new Error(`Property exists on type '${type.asString()}' but was not found on compile-time type '${target.compileTimeType.asString()}'`)
      }

      if (prop.value) {
        values.compileTimeValue = prop.value
      }
    }

    if (!values.compileTimeValue?.hasValue) {
      let toLoc = this.storageLoc(), fromLoc = this.instanceFieldLoc(key, shared)
      let modifyFuncId = this.dynamicStorageModify(toLoc.asDataString(), fromLoc.asDataString())

      values.storage = {
        location: toLoc,
        options: {
          before: Compiler.join`function ${modifyFuncId} with ${target.asDataString()}`
        }
      }
    }

    let generics = replaceGenerics && target.type.getGenericMap()
    return new Expression(
      generics ? propType.replaceGenerics(generics) : propType,
      values
    )
  }

  setProperty(target, name, value, bypassConst = false) {
    let { type } = target

    if (type.nullable) {
      let isNull = type.isNull()
      throw new error.TypeError(`Cannot set properties of ${isNull ? "" : "potentially "}null value (setting '${name}' on expression of type '${type.asString()}')`)
    }

    let propType = type.getPropType(name)

    if (!value.type.isSubtypeOf(propType)) {
      throw new error.TypeError(`Cannot assign value of type '${value.type.asString()}' to property of type ${propType.asString()}'`)
    }

    if (target.compileTimeValue) {
      console.log({ target, name, value })
      throw new Error("Attempting to assign to property with a compile-time value")
    }

    let { access, root: { key, shared, writable } } = type.getPropAccessData(name)

    if (!bypassConst && !writable) {
      throw new error.ReferenceError(`Cannot assign to constant property '${name}' of type '${type.asString()}'`)
    }

    // TODO check property access privilege

    let toLoc = this.instanceFieldLoc(key, shared)
    let { str: valueStr, options: { before } } = value.asExtendedDataString()
    let modifyFuncId = this.dynamicStorageModify(toLoc.asDataString(), valueStr, true)

    return concat(
      before,
      Compiler.join`function ${modifyFuncId} with ${target.asDataString()}`
    )
  }

  ////////////////////////////////

  compileType(ast, preventVoid = null) {
    switch (ast.type) {
      case "null":    return new NullType()
      case "any":     return new AnyType()
      case "never":   return new NeverType(ast.nullable)
      case "unknown": return Type.unknown()

      case "void":
        if (preventVoid) throw new error.TypeDefinitionError(`${preventVoid} (type 'void')`)
        return new VoidType(ast.nullable)

      case "union":
        return new UnionType(ast.types.map(ast => this.compileType(ast, preventVoid)))

      case "intersection":
        // intersection type w/ void element is not necessarily maybeVoid()
        let intersection = new IntersectionType(ast.types.map(ast => this.compileType(ast)))
        if (preventVoid && intersection.maybeVoid()) throw new error.TypeDefinitionError(`${preventVoid} (type '${intersection.asString()}')`)
        return intersection

      case "tuple":
        return new TupleType(ast.types.map(
          ast => ({ ...ast, type: this.compileType(ast.type, "Tuple types cannot contain (potentially) void types") })
        ))

      case "class":
        let type = this.env.getType(ast.name)
        if (!type) throw new error.TypeReferenceError(`Unknown type '${ast.name}'`)
        return Type.fromEnv(type, ast.nullable, this.compileGenerics(ast.generics), preventVoid)

      case "array":
        return new ClassType(this.lang.Array, ast.nullable, [this.compileType(ast.generic, "Cannot create an array type of a (potentially) void type")])

      case "func":
        return new ClassType(this.lang.Function, ast.nullable, [
          ...ast.params.map(ast => this.compileType(ast, "Function parameters cannot be a (potentially) void type")),
          this.compileType(ast.returnType)
        ], { paramNames: ast.params.map(ast => ast.paramName) })

      default:
        console.log(ast)
        throw new Error(`Invalid type type '${ast.type}'`)
    }
  }

  compileGenerics(generics) {
    return generics.map(ast => {
      let { type, generic } = ast, compiledType

      if (generic) {
        if (type) {
          throw new Error("Malformed generic type AST with both 'type' and 'generic' key")
        }

        let extendsType
        if (generic.extends) {
          extendsType = this.compileType(generic.extends)

          // TODO not quite right condition - should be valid if there is any overlap between any[] and the provided type
          if (ast.spread && !extendsType.is(this.lang.Array, false, [new AnyType()])) {
            throw new error.TypeDefinitionError(`${generic.name ? "Inline" : "Anonymous inline"} spread generic${generic.name ? ` '${generic.name}'` : ""} must extend Array (found 'extends ${extendsType.asString()}' instead)`)
          }
        } else {
          extendsType = ast.spread ? new ClassType(this.lang.Array) : Type.unknown()
        }

        let genericData = {
          name: generic.name,
          extends: extendsType,
          explicitExtends: !!generic.extends
          // super
        }
        if (generic.name) {
          if (this.env.getOwnType(generic.name)) {
            throw new error.TypeDefinitionError(`Type name '${generic.name}' is already in use`)
          }
          this.env.registerGenericType(generic.name, genericData)
        } else {
          genericData.name = GenericType.anonymousPlaceholder()
          genericData.anonymous = true
        }
        compiledType = new GenericType(genericData, false)
      } else if (type) {
        compiledType = this.compileType(type)
      } else {
        console.log(ast)
        throw new Error("Malformed generic type AST. Must have either 'type' or 'generic' key")
      }

      return ast.spread ? { spread: true, type: compiledType } : compiledType
    })
  }
}
