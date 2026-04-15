class Parser {
  constructor(lexer) {
    this.lexer = lexer

    let maxPrecedence = this.OPERATOR_PRECEDENCE_ARRAY.length
    this.OPERATOR_PRECEDENCE = Object.fromEntries(
      this.OPERATOR_PRECEDENCE_ARRAY.flatMap(
        (arr, i) => arr.map(op => [op, maxPrecedence - i])
      )
    )
  }

  parse() {
    return this.parseBlock({ global: true })
  }

  inFunction = false

  parseBlock({ global = false, inFunction = false } = {}) {
    let statements = []

    let wasInFunction = this.inFunction
    this.inFunction ||= inFunction

    while (true) {
      if (this.lexer.eof) {
        if (!global) {
          this.lexer.next()
          throw this.unexpectedTok("expected a statement or closing '}'")
        }
        break
      }

      let tok = this.lexer.peek(), seenSemicolon = !statements.length

      if (!seenSemicolon && tok.type === "punctuation" && tok.value === ";") {
        seenSemicolon = true
        this.lexer.next()
        tok = this.lexer.peek()
      }

      if (tok.type === "punctuation" && tok.value === "}") {
        if (global) throw new error.SyntaxError("Unmatched closing curly brace")

        this.lexer.next()
        break
      }

      if (!seenSemicolon && !tok.afterNewLine) {
        this.lexer.next()
        throw this.unexpectedTok("expected a new line or semicolon after statement")
      }

      statements.push(this.parseStatement(global))
    }

    this.inFunction = wasInFunction
    return statements
  }

  parseStatement(global) {
    let tok = this.lexer.next()

    if (tok.type === "keyword") {
      switch (tok.value) {
        case "print":    return this.parsePrint()
        case "let":      return this.parseVariable()
        case "const":    return this.parseVariable(true)
        case "if":       return this.parseIf()
        case "while":    return this.parseWhile()
        case "function": return this.parseFunction()
        case "return":
          if (!this.inFunction) {
            throw new error.SyntaxError("Return statements are only valid inside functions")
          }
          return this.parseReturn()
        case "class":
          if (!global) {
            throw new error.SyntaxError("Classes can only be declared in the global scope")
          }
          return this.parseClass()
      }
    } else if (tok.type === "punctuation" && tok.value === "{") {
      return { type: "block", value: this.parseBlock() }
    }

    return {
      type: "expression",
      value: this.parseExpression(tok)
    }
  }

  ////////////////////////////////

  parseParameterList() {
    let params = [], seenOptional = false

    do {
      let rest = this.nextIf("punctuation", "..."),
          name = this.expectType("identifier", "expected an identifier for parameter name").value,
          dataType = this.nextIf("operator", ":") ? this.parseType() : null,
          defaultValue = this.nextIf("operator", "=") ? this.parseExpression() : null

      if (defaultValue) {
        if (rest) {
          throw new error.SyntaxError(`Rest parameter (...${name}) cannot have a default value`)
        } else {
          seenOptional = true
        }
      } else if (seenOptional) {
        // TODO maybe allow optional params not at end
        //      fill required params first, then optional, then ...rest
        throw new error.SyntaxError("Optional parameters cannot be followed by required parameters")
      }

      params.push({
        name,
        dataType,
        rest,
        defaultValue
      })

      // TODO allow rest parameter anywhere
      if (rest && this.nextIf("punctuation", ",")) {
        throw new error.SyntaxError(`Rest parameter (...${name}) must be the last parameter`)
      }
    } while (this.nextIf("punctuation", ","))

    return params
  }

  VALID_HASH_KEY_TYPES = new Set(["identifier", "keyword", "string"])

  parseKeyValueList() {
    let items = {}

    do {
      let key = this.lexer.next()

      if (!this.VALID_HASH_KEY_TYPES.has(key.type))
        throw this.unexpectedTok("expected a hash key (name or string)")

      this.expect("operator", ":", "expected a ':' to follow hash key")

      items[key.value] = this.parseExpression()
    } while (this.nextIf("punctuation", ","))

    return items
  }

  parseExpressionList() {
    let exprs = []

    do exprs.push(this.parseExpression())
    while (this.nextIf("punctuation", ","))

    return exprs
  }

  parseExpression(tok = null) {
    if (tok) this.lexer.previous()

    // TODO use less terribly slow algorithm for operator precedence
    return this.joinExpressionParts(this.parseExpressionParts())
  }

  joinExpressionParts(parts) {
    let iterations = 0, maxIterations = 10000

    while (parts.length > 1) {
      let index = parts.findIndex((operator, i) => {
        if (operator.type !== "operator") return

        let beforeExpr = parts[i - 1]?.type !== "operator",
            afterExpr = parts[i + 1]?.type !== "operator"

        let beforeOperator = parts[i - 2],
            afterOperator = parts[i + 2]

        let { precedence } = operator

        if (operator.prefix) {
          return afterExpr && (!afterOperator || afterOperator.precedence <= precedence)
        } else if (operator.postfix) {
          return beforeExpr && (!beforeOperator || beforeOperator.precedence < precedence)
        } else {
          return beforeExpr && afterExpr && (
            operator.rtl
              ? (!beforeOperator || beforeOperator.precedence <= precedence) && (!afterOperator || afterOperator.precedence <  precedence)
              : (!beforeOperator || beforeOperator.precedence <  precedence) && (!afterOperator || afterOperator.precedence <= precedence)
          )
        }
      })

      if (index === -1 || ++iterations >= maxIterations) {
        console.log(parts)
        throw new Error(`Unable to join expression parts; ${index === -1 ? "could not find joinable operator" : `too many iterations (${iterations})`}`)
      }

      let operator = parts[index]

      if (operator.prefix) {
        parts.splice(index, 2, {
          type: "operation",
          operator: operator.value,
          right: parts[index + 1],
          extra: operator.extra
        })
      } else if (operator.postfix) {
        parts.splice(index - 1, 2, {
          type: "operation",
          operator: operator.value,
          left: parts[index - 1],
          extra: operator.extra
        })
      } else {
        parts.splice(index - 1, 3, {
          type: "operation",
          operator: operator.value,
          left: parts[index - 1],
          right: parts[index + 1],
          extra: operator.extra
        })
      }
    }

    return parts[0]
  }

  parseExpressionParts() {
    let parts = [], operator

    do {
      if (operator) parts.push(operator)

      // TODO special case for . operator - parse an identifier after, not an expression

      parts.push(...this.parseNoOpExpressionWithUnary(this.lexer.next()))
    } while (operator = this.parseOptionalOperator())

    return parts
  }

  OPERATOR_PRECEDENCE_ARRAY = [
    ["."],
    // [":"],
    ["(", "["],
    ["++", "--"],
    ["!", "PRE+", "PRE-"], // prefix +/- replaced with PRE+/- to differentiate from binary +/-
    ["**"],
    ["*", "/", "%"],
    ["+", "-"],
    [".."],
    ["<<", ">>"],
    ["<", ">", "<=", ">="],
    ["==", "!="],
    ["&"],
    ["^"],
    ["|"],
    ["&&"],
    ["||"],
    ["??"],
    // ["?"],
    ["=", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "^=", "|=", "&&=", "||=", "??=", "<<=", ">>=", "..="]
  ]

  RTL_OPERATORS = new Set([
    "**", "=", "+=", "-=", "*=", "/=", "%=", "**=", "&=", "^=", "|=", "&&=", "||=", "??=", "<<=", ">>=", "..="
  ])

  PREFIX_OPERATORS = new Set(["+", "-", "!", "++", "--"])

  POSTFIX_OPERATORS = new Set(["(", "[", "++", "--", ":"])

  ALWAYS_UNARY_OPERATORS = new Set(["!", "++", "--"])

  parseOptionalOperator() {
    let tok = this.lexer.peek()

    if (!tok || tok.type !== "operator" || this.ALWAYS_UNARY_OPERATORS.has(tok.value))
      return null

    this.lexer.next()

    // TODO special case for ternary

    return {
      type: "operator",
      value: tok.value,
      precedence: this.OPERATOR_PRECEDENCE[tok.value],
      rtl: this.RTL_OPERATORS.has(tok.value)
    }
  }

  parseNoOpExpressionWithUnary(tok = this.lexer.next()) {
    if (!tok) {
      throw this.unexpectedTok("expected an expression")
    }

    let parts = []

    while (tok?.type === "operator" && this.PREFIX_OPERATORS.has(tok.value)) {
      let op = tok.value.replace(/^[-+]$/, "PRE$&")
      parts.push({
        type: "operator",
        value: tok.value,
        precedence: this.OPERATOR_PRECEDENCE[op],
        rtl: false,
        prefix: true
      })
      tok = this.lexer.next()
    }

    parts.push(this.parseNoOpExpression(tok))

    tok = this.lexer.peek()

    while (
      tok
        && !tok.afterNewLine
        && (tok.type === "operator" || tok.type === "punctuation")
        && this.POSTFIX_OPERATORS.has(tok.value)
    ) {
      this.lexer.next()

      let obj = {
        type: "operator",
        value: tok.value,
        precedence: this.OPERATOR_PRECEDENCE[tok.value],
        rtl: false,
        postfix: true
      }

      if (tok.value === "(" && !this.nextIf("punctuation", ")")) {
        obj.extra = this.parseExpressionList() // TODO better param parsing with ...spread
        this.expect("punctuation", ")", "expected closing ')' to end function call")
      } else if (tok.value === "[") {
        obj.extra = this.parseExpression()
        this.expect("punctuation", "]", "expected closing ']' to end property access")
      } else if (tok.value === ":") {
        obj.extra = this.parseType()
      }

      parts.push(obj)

      tok = this.lexer.peek()
    }

    return parts
  }

  parseNoOpExpression(tok = this.lexer.next()) {
    if (tok.type === "punctuation" && tok.value === "(") {
      // try {
      let expr = this.parseExpression()
      // } catch {
        // TODO arrow fn
      // }

      this.expect("punctuation", ")", "expected a closing ')' to end group")

      // if (this.nextIf("punctuation", "=>")) {
        // TODO arrow fn
      // }

      return expr
    } else if (tok.type === "punctuation" && tok.value === "[") {
      let dataType = this.parseType(), items = []

      if (!this.nextIf("punctuation", "]")) {
        if (!this.nextIf("punctuation", ";") && !this.lexer.peek().afterNewLine) {
          this.lexer.next()
          throw this.unexpectedTok("expected a semicolon, new line, or closing ']' after type of array literal")
        }

        items = this.parseExpressionList()
        this.expect("punctuation", "]", "expected a comma or closing ']' to end array literal")
      }

      return {
        type: "array",
        dataType,
        items
      }
    } /* TODO maybe add back hash literal?
    else if (tok.type === "punctuation" && tok.value === "{") {
      let items = {}

      if (!this.nextIf("punctuation", "}")) {
        items = this.parseKeyValueList()
        this.expect("punctuation", "}")
      }

      return {
        type: "hash",
        items
      }
    } */
    else if (tok.type === "keyword" && tok.value === "new") {
      let { name, generics } = this.parseClassType(false), args = []

      this.expect("punctuation", "(", "expected '(' to begin arguments of 'new' expression")
      if (!this.nextIf("punctuation", ")")) {
        args = this.parseExpressionList() // TODO better param parsing with ...spread
        this.expect("punctuation", ")", "expected closing ')' to end arguments of 'new' expression")
      }
      return {
        type: "new",
        name,
        generics,
        args
      }
    } else return this.parseLiteral(tok)
  }

  NUMBER_TYPES = {
    b: "byte",
    s: "short",
    i: "int",
    l: "long",
    f: "float",
    d: "double"
  }

  parseLiteral(tok = this.lexer.next()) {
    if (tok.type === "string") {
      return {
        type: "string",
        value: tok.value
      }
    } else if (tok.type === "identifier") {
      return {
        type: "reference",
        value: tok.value
      }
    } else if (tok.type === "number") {
      let num = tok.value, type = num.includes(".") ? "d" : "i"

      if (/[bsilfd]$/.test(num)) {
        type = num[num.length - 1]
        num = num.slice(0, -1)
      }

      // TODO check to see if numbers are in bounds of their type

      if (/^0[box]/.test(num)) {
        try {
          num = BigInt(num).toString()
        } catch {
          throw new error.RangeError("Number too large to compile")
        }
      }

      return {
        type: this.NUMBER_TYPES[type],
        value: num
      }
    } else if (tok.type === "keyword" && ["true", "false"].includes(tok.value)) {
      return {
        type: "boolean",
        value: tok.value === "true"
      }
    } else if (tok.type === "keyword" && tok.value === "null") {
      return { type: "null" }
    } else if (tok.type === "comp-dir") {
      let params = null

      if (this.nextIf("punctuation", "(")) {
        if (this.nextIf("punctuation", ")")) {
          params = []
        } else {
          params = this.parseExpressionList()
          this.expect("punctuation", ")", "expected closing ')' to end compiler directive call")
        }
      }

      return {
        type: "comp-dir",
        value: tok.value,
        params
      }
    } else throw this.unexpectedTok()
  }

  ////////////////////////////////

  parsePrint() {
    return {
      type: "print",
      values: this.parseExpressionList()
    }
  }

  parseVariable(isConst = false) {
    return {
      type: "variable",
      const: isConst,
      name: this.expectType("identifier", "expected an identifier for variable name").value,
      dataType: this.nextIf("operator", ":") ? this.parseType() : null,
      value: this.nextIf("operator", "=") ? this.parseExpression() : { type: "null" }
    }
  }

  parseIf() {
    return {
      type: "if",
      condition: this.parseExpression(),
      body: this.parseStatement(),
      else: this.nextIf("keyword", "else") ? this.parseStatement() : null
    }
  }

  parseWhile() {
    return {
      type: "while",
      condition: this.parseExpression(),
      body: this.parseStatement()
    }
  }

  parseFunction() {
    let name = this.expectType("identifier", "expected an identifier for function name").value, params

    this.expect("punctuation", "(", "expected '(' to begin arguments of function declaration")
    if (!this.nextIf("punctuation", ")")) {
      params = this.parseParameterList()
      this.expect("punctuation", ")", "expected ')' to end arguments of function declaration")
    } else {
      params = []
    }

    let returnType = this.nextIf("operator", ":") ? this.parseType() : null
    this.expect("punctuation", "{", "expected '{' to open class method body")

    return {
      type: "function",
      name,
      params,
      returnType,
      body: this.parseBlock({ inFunction: true })
    }
  }

  parseReturn() {
    return {
      type: "return",
      value: this.lexer.peek().afterNewLine ? null : this.parseExpression()
    }
  }

  parseClass() {
    let name = this.expectType("identifier", "expected an identifier for class name").value,
        generics = [],
        superclass = null,
        superGenerics = []

    if (this.nextIf("operator", "<")) {
      generics = this.parseGenericsDefinition()
      this.expect("operator", ">", "expected '>' to close type generics")
    }

    if (this.nextIf("keyword", "extends")) {
      ({ name: superclass, generics: superGenerics } = this.parseClassType(false))
    }

    this.expect("punctuation", "{", "expected '{' to open class body")

    let props = []

    while (!this.nextIf("punctuation", "}")) {
      let isStatic = this.nextIf("keyword", "static")
      let data = {
        static: isStatic,
        final: !isStatic && this.nextIf("keyword", "final"),
        shared: !isStatic && this.nextIf("keyword", "shared"),
        writable: !this.nextIf("keyword", "const"),
        // TODO allow name (public), #name (private), and ##name (protected)
        name: this.expectType("identifier", "expected an identifier for class field/method name").value
      }

      if (data.final && !data.writable) {
        throw new error.SyntaxError(`Conflicting modifiers 'final' and 'const' on property '${data.name}'`)
      }

      // TODO dont allow 'final #name' (final on private property)

      if (this.nextIf("punctuation", "(")) {
        data.type = "method"

        // these are always implicitly true for methods
        if (data.shared || !data.writable) {
          let mod = data.shared ? !data.writable ? "s 'shared' or 'const'" : " 'shared'" : " 'const'"
          let imp = data.shared ? !data.writable ? "shared and constant" : "shared" : "constant"
          throw new error.SyntaxError(`Class method '${data.name}' cannot have explicit modifier${mod} (methods are always implicitly ${imp})`)
        }

        if (!this.nextIf("punctuation", ")")) {
          data.params = this.parseParameterList()
          // TODO parameter type inference
          if (!data.params.every(param => param.dataType)) {
            throw new error.UnimplementedError("Parameter type inference is not yet implemented")
          }

          this.expect("punctuation", ")", "expected ')' to end class method parameters")
        } else {
          data.params = []
        }

        data.returnType = this.nextIf("operator", ":") ? this.parseType() : null

        this.expect("punctuation", "{", "expected '{' to open class method body")

        data.body = this.parseBlock({ inFunction: true })
      } else {
        data.type = "field"

        if (data.shared) {
          if (!data.writable) consoleWarn("Unnecessary field modifier 'const'; shared fields are automatically constant")
          else data.writable = false
        }

        if (this.nextIf("operator", ":")) {
          data.dataType = this.parseType()
        }

        data.value = this.nextIf("operator", "=") ? this.parseExpression() : null
      }

      props.push(data)
    }

    return {
      type: "class",
      name,
      generics,
      superclass,
      superGenerics,
      props
    }
  }

  ////////////////////////////////

  parseType() {
    let first = this.parseTypeNoUnion()

    let union = false
    if (this.nextIf("operator", "|")) {
      union = true
    } else if (!this.nextIf("operator", "&")) {
      return first
    }

    let types = [first]

    do types.push(this.parseTypeNoUnion())
    while (this.nextIf("operator", union ? "|" : "&"))

    if (this.nextIf("operator", union ? "&" : "|")) {
      throw new error.SyntaxError("Cannot mix '|' and '&' in type definitions. Use parentheses to disambiguate order of operations")
    }

    return { type: union ? "union" : "intersection", types }
  }

  ALWAYS_NULLABLE_TYPES = new Set(["null", "any", "unknown"])
  RESERVED_TYPE_NAMES = new Set(["any", "never", "unknown", "void"])

  parseTypeNoUnion() {
    if (this.nextIf("punctuation", "(")) {
      return this.parseArrowFuncType()
    }

    let type

    if (this.nextIf("keyword", "null")) {
      type = { type: "null" }
    } else if (this.nextIf("identifier", "any")) {
      type = { type: "any" }
    } else if (this.nextIf("identifier", "never")) {
      type = { type: "never" }
    } else if (this.nextIf("identifier", "unknown")) {
      type = { type: "unknown" }
    } else if (this.nextIf("identifier", "void")) {
      type = { type: "void" }
    } else if (this.nextIf("punctuation", "[")) {
      type = {
        type: "tuple",
        types: this.parseTupleTypeList()
      }
    } else {
      type = {
        type: "class",
        ...this.parseClassType(true, true)
      }
    }

    if (this.nextIf("operator", "?")) {
      if (this.ALWAYS_NULLABLE_TYPES.has(type.type)) {
        consoleWarn(`Redundant nullable modifier '?' in type '${type.type}?'`)
      } else {
        type.nullable = true
      }
    }

    while (this.nextIf("punctuation", "[", false)) {
      // TODO allow indexed access (into tuples)
      this.expect("punctuation", "]", "expected closing ']' for array type shorthand")
      type = {
        type: "array",
        generic: type
      }

      if (this.nextIf("operator", "?")) type.nullable = true
    }

    if (this.nextIf("punctuation", "=>")) {
      // actually an arrow function type - not a class type
      type.paramName = null
      return {
        type: "func",
        params: [type],
        returnType: this.parseType(),
        nullable: false
      }
    }

    return type
  }

  parseArrowFuncType() {
    let params = []

    if (!this.nextIf("punctuation", ")")) {
      do {
        let tok = this.lexer.next(), next = this.lexer.peek(), name = null

        if (tok.type === "identifier" && next.type === "operator" && next.value === ":") {
          this.lexer.next()
          name = tok.value
        } else {
          this.lexer.previous()
        }

        let type = this.parseType()
        type.paramName = name
        params.push(type)
      } while (this.nextIf("punctuation", ","))

      this.expect("punctuation", ")", "expected ')' to end arrow function type parameters")
    }

    if (!this.nextIf("punctuation", "=>")) {
      if (params.length === 1 && !params[0].name) {
        // actually not an arrow function type - just a type in grouping parentheses
        let type = params[0]
        if (this.nextIf("operator", "?")) {
          if (type.nullable || this.ALWAYS_NULLABLE_TYPES.has(type.type)) {
            consoleWarn(`Redundant nullable modifier '?' on${!type.nullable ? ` '${type.type}'` : ""} type`)
          } else {
            type.nullable = true
          }
        }
        return type
      } else {
        this.lexer.next()
        throw this.unexpectedTok("expected '=>' after arrow function type parameters")
      }
    }

    return {
      type: "func",
      params,
      returnType: this.parseType(),
      nullable: false
    }
  }

  parseTupleTypeList() {
    let types = []

    if (this.nextIf("punctuation", "]")) return types

    do {
      let count = 1, variadic = false, totalLength = 0

      if (this.nextIf("operator", "*")) {
        count = 0
        variadic = true
      } else {
        let tok = this.lexer.peek()
        if (tok?.type === "number") {
          this.lexer.next()

          if (!/^\d+$/.test(tok.value)) {
            throw new error.SyntaxError("Repeat count of type in tuple type must be a positive unsized integer")
          }

          count = parseInt(tok.value)
          if (count < 1 || count > NUMBER_RANGES.int.max) {
            throw new error.RangeError(`Repeat count of type in tuple type must be between 1 and max array index ${NUMBER_RANGES.int.max} (inclusive)`)
          }
          totalLength += count
          if (totalLength > NUMBER_RANGES.int.max) {
            throw new error.RangeError(`Total minimum length of tuple type cannot be more than max array index ${NUMBER_RANGES.int.max}`)
          }
        }

        if (this.nextIf("operator", "+")) {
          variadic = true
        }
      }

      types.push({
        count,
        variadic,
        type: this.parseType()
      })
    } while (this.nextIf("punctuation", ","))

    this.expect("punctuation", "]", "expected ']' to end tuple type")

    return types
  }

  parseClassType(allowGenericDefinitions, generalErrorMessage = false) {
    let name = this.expectType("identifier", generalErrorMessage ? "expected a type" : "expected an identifier for class name").value,
        generics = []

    if (this.RESERVED_TYPE_NAMES.has(name)) {
      throw new error.TypeReferenceError(`Type name '${name}' is reserved for the built-in type of the same name`)
    }

    if (this.nextIf("operator", "<")) {
      generics = this.parseGenericsReference(allowGenericDefinitions)

      // hack to parse >> operator as two separate tokens when parsing a type
      if (this.nextIf("operator", ">>")) {
        this.lexer.insertToken("operator", ">")
      } else {
        this.expect("operator", ">", "expected '>' to close superclass type generics")
      }
    }

    return { name, generics }
  }

  parseGenericsReference(allowDefinitions) {
    let generics = []

    /*

    references:

    Type
    ...Type

    declarations:

    TODO instead of 'Array<type T>' syntax, use '<T> Array<T>'
         - generalization of generics on function types
         - allows for: '<T> T => T', '<T> Map<T, T>', etc.

    ?
    type T

    ...
    ...?
    ...type T

    extends Type
    ? extends Type
    type T extends Type

    ... extends Type
    ...? extends Type
    ...type T extends Type

    */

    do {
      let data = {
        spread: this.nextIf("punctuation", "...")
      }

      if (this.nextIf("keyword", "type")) {
        if (!allowDefinitions) {
          throw new error.SyntaxError("Inline generic definitions are not allowed in this context") // TODO caller-supplied error msg
        }

        data.generic = {
          name: this.expectType("identifier", "expected an identifier for inline generic type name").value
        }
      } else if (this.nextIf("operator", "?")) {
        if (!allowDefinitions) {
          throw new error.SyntaxError("Anonymous inline generics ('?') are not allowed in this context") // TODO caller-supplied error msg
        }

        data.generic = {}
      }

      if (this.nextIf("keyword", "extends")) {
        if (!allowDefinitions) {
          throw new error.SyntaxError(`Inline generics ('extends ...') are not allowed in this context`) // TODO caller-supplied error msg
        }

        data.generic ||= {}
        data.generic.extends = this.parseType()
      } else if (!data.generic) {
        data.type = this.parseType()
      }

      generics.push(data)
    } while (this.nextIf("punctuation", ","))

    return generics
  }

  parseGenericsDefinition() {
    let generics = []

    do {
      let variance = this.nextIf("keyword", "in") ? "in" : null
      if (this.nextIf("keyword", "out")) {
        variance = variance ? null : "out"
      }

      let rest = this.nextIf("punctuation", "..."),
          name = this.expectType("identifier", "expected an identifier for generic name").value,
          extendsType = this.nextIf("keyword", "extends") ? this.parseType() : null,
          // superType = !extendsType && this.nextIf("keyword", "super") ? this.parseType() : null,
          defaultType = this.nextIf("operator", "=") ? this.parseType() : null

      generics.push({
        rest,
        name,
        variance,
        extends: extendsType,
        default: defaultType
      })
    } while (this.nextIf("punctuation", ","))

    return generics
  }

  ////////////////////////////////

  nextIf(type, value, afterNewLine = null) {
    let tok = this.lexer.peek()

    if (tok && tok.type === type && tok.value === value && (afterNewLine === null || tok.afterNewLine === afterNewLine)) {
      this.lexer.next()
      return true
    }

    return false
  }

  expectType(type, text = null, tok = this.lexer.next()) {
    if (!tok || tok.type !== type) {
      throw this.unexpectedTok(text)
    }

    return tok
  }

  expect(type, value, text = null, tok = this.lexer.next()) {
    if (!tok || tok.type !== type || tok.value !== value) {
      throw this.unexpectedTok(text)
    }
  }

  unexpectedTok(text = null) {
    let tok = this.lexer.current()
    return new error.SyntaxError(`Unexpected ${tok ? this.stringifyTok(tok) : "end of file"}${text ? `; ${text}` : ""}`)
  }

  stringifyTok(tok) {
    return `${tok.type.replace("comp-dir", "compiler directive")} ${this.stringifyTokValue(tok, true)}`
  }

  stringifyTokValue(tok, singleQuotes = false) {
    if (tok.type === "string") return `"${tok.value}"`

    let value = tok.type === "comp-dir" ? `#${tok.value}` : tok.value
    return singleQuotes ? `'${value}'` : value
  }
}
