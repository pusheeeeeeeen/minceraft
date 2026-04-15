class Value {
  static null() {
    return new Value(new NullType(), null)
  }

  // create a value representing an instance of a class
  static instance(cl, value, nullable = false, generics = []) {
    return new Value(new ClassType(cl, nullable, generics), value)
  }

  constructor(type, value = undefined) {
    if (!type.isRuntimeType()) {
      console.log(type.asString(), value)
      throw new Error("Value type must be a valid runtime type (non-nullable ClassType or NullType)")
    } else if ((value === null && !type.nullable) || (value != null && type instanceof NullType)) {
      console.log(type.asString(), value)
      throw new Error("Value constructor - mismatch between (non-)null value and (non-)null type")
    }

    this.type = type
    this.value = value
    this.hasValue = value !== undefined
    this.isClass = type.instanceOf === compiler.lang.Class
  }

  verifyIsClass(methodName) {
    if (!this.isClass) {
      throw new Error(`Value.${methodName}() can only be called on values that represent classes`)
    }
  }

  isSubclassOf(cl, includeSameClass = true) {
    this.verifyIsClass("isSubclassOf")

    return this === cl ? includeSameClass : !!this.value.superclass?.isSubclassOf(cl)
  }

  traceGenericsToSuperclass(generics) {
    this.verifyIsClass("traceGenericsToSuperclass")

    // TODO use compiler.assignGenerics

    let superclass = this.value.superclass
    if (!superclass) return null

    if (!superclass.value.generics.length) return []

    return this.value.superGenerics.map((x) => {
      if (x instanceof GenericType) {
        let i = this.value.generics.indexOf(x.generic)
        if (i !== -1) return generics[i]
      }

      return x
    })
  }

  getInstanceProp(name) {
    this.verifyIsClass("getInstanceProp")

    return this.value.instanceProps[name] || this.value.superclass?.getInstanceProp(name) || null
  }

  getStaticProp(name) {
    this.verifyIsClass("getStaticProp")

    return this.value.staticProps[name] || null
  }

  getPropData(name) {
    return this.type.instanceOf?.getInstanceProp(name) || null
  }

  ////////////////////////////////

  asSNBTValueOnly() {
    if (!this.hasValue) {
      throw new Error("Value.asSNBTValueOnly() called on a type-only value")
    }

    let literalName = this.type.literalTypeName

    if (literalName) switch (literalName) {
      case "boolean":
      case "string": return NBT.stringify(this.value)
      case "byte":   return `${this.value}b`
      case "short":  return `${this.value}s`
      case "int":    return `${this.value}i`
      case "long":   return `${this.value}l`
      case "float":  return `${this.value}f`
      case "double": return `${this.value}d`
      case "null":   return "{}"
      default:
        throw new Error(`Unable to compile value of literal type '${literalName}'`)
    }

    if (this.type.isFunction()) {
      if (!this.value.id) {
        if (!this.value.func) throw new Error("Function value without .id or .func")
        this.value.id = compiler.registerFunction(compiler.compileFunctionFromJS(this.value.func, this.type))
      }

      return NBT.stringify(this.value.id)
    }

    // TODO wrong - array contents needs to go on heap
    // if (this.type.instanceOf === compiler.lang.Array) {
    //   if (!Array.isArray(this.value)) {
    //     throw new Error("Value of Array-type value must be a JS array")
    //   }
    //
    //   return NBT.stringifyInlineStrings(this.value.map(val => val.asSNBT()))
    // }

    console.log(this.type.asString(), this)
    throw new Error(`Unable to compile value of type '${this.type.asString()}'`)
  }

  asSNBT() {
    return `{${this.type.asSNBTProperties()},v:${this.asSNBTValueOnly()}}`
  }

  asScore() {
    if (!this.type.isScoreboardCompatible()) {
      throw new Error("Value.asScore() called on a type that is not scoreboard compatible")
    }

    return this.type.literalTypeName === "boolean"
      ? (this.value ? "1" : "0")
      : this.value
  }
}
