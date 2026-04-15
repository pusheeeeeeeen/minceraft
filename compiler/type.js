function addParens(str, doParens = true) {
  return doParens ? `(${str})` : str
}

////////////////////////////////

class Type {
  static SCOREBOARD_COMPATIBLE = new Set(["byte", "short", "int", "boolean"])

  static union(...classes) {
    return new UnionType(classes.map(x => new ClassType(x)))
  }

  static unknown() {
    return new ClassType(compiler.lang.Object, true)
  }

  static unknownOrVoid() {
    return new UnionType([this.unknown(), new VoidType()])
  }

  static unknownFunction() {
    return new ClassType(compiler.lang.Function, false, [
      { spread: true, type: new AnyType() },
      new VoidType()
    ])
  }

  static fromEnv(obj, nullable, generics, preventVoid = null) {
    if (obj.generic) {
      if (generics?.length) {
        throw new error.TypeDefinitionError(`Generic type references cannot have generics: '${obj.name}${Type.stringifyGenerics(generics)}'`)
      }
      let type = new GenericType(obj.generic, nullable)
      if (preventVoid && type.maybeVoid()) {
        throw new error.TypeDefinitionError(`${preventVoid} (type '${type.asString()}')`)
      }
      return type
    } else {
      return new ClassType(obj.class, nullable, generics)
    }
  }

  static stringifyGenerics(generics) {
    return generics.length ? `<${generics.map(
      x => x instanceof Type ? x.asString() : `${x.spread ? "..." : ""}${x.type.asString()}`
    ).join(", ")}>` : ""
  }

  ////////////////////////////////

  constructor(nullable) {
    if (new.target === Type) {
      throw new Error("Cannot create instances of Type class directly - must use a subclass")
    }

    this.nullable = nullable
  }

  ////////////////////////////////

  /** @abstract */
  getPropType() {
    throw new Error("Subclasses of Type must implement 'getPropType()'")
  }

  /** @abstract */
  getPropAccessData() {
    throw new Error("Subclasses of Type must implement 'getPropAccessData()'")
  }

  ////////////////////////////////

  /** @abstract */
  get literalTypeName() {
    throw new Error("Subclasses of Type must implement 'get literalTypeName()'")
  }

  /** @abstract */
  asNullable() {
    throw new Error("Subclasses of Type must implement 'asNullable()'")
  }

  is(cl, nullable = false, generics = []) {
    if (this.maybeVoid()) return false
    if (this.nullable && !nullable) return false

    return this.isSubtypeOf(new ClassType(cl, nullable, generics))
  }

  isNull() {
    return false
  }

  maybeVoid() {
    return false
  }

  isFunction() {
    // TODO make true for non-class types that are always functions - theoretically equivalent to this.isSubtypeOf(Function<...?>) or something
    //      (requires more extensive type checking in Expression.call())
    return false
  }

  isScoreboardCompatible() {
    return false
  }

  isRuntimeType() {
    return false
  }

  isFinal() {
    return false
  }

  getGenericMap() {
    return null
  }

  replaceGenerics() {
    return this
  }

  isSubtypeOf(type) {
    if (type instanceof NeverType) return false
    if (this.maybeVoid() && !type.maybeVoid()) return false
    if (type instanceof AnyType || type instanceof VoidType) return true
    if (this.nullable && !type.nullable) return false

    return this._isSubtypeOf(type)
  }

  /** @abstract */
  _isSubtypeOf() {
    throw new Error("Subclasses of Type must implement '_isSubtypeOf()'")
  }

  isEquivalentTo(type) {
    return this.isSubtypeOf(type) && type.isSubtypeOf(this)
  }

  asCompiledString() {
    if (this.isRuntimeType()) {
      throw new Error("Subclasses of Type where `isRuntimeType() === true` must implement 'asCompiledString()'")
    } else {
      throw new Error("Can't call 'asCompiledString()' on a class that is not a valid runtime type")
    }
  }

  asSNBTProperties() {
    return `t:${this.asCompiledString()}`
  }

  asSNBT() {
    return `{${this.asSNBTProperties()}}`
  }

  /** @abstract */
  asString() {
    throw new Error("Subclasses of Type must implement 'asString()'")
  }

  asNamedString(name) {
    return `${name}: ${this.asString()}`
  }

  ////////////////////////////////

  // __proto__ is gotten only when the class is logged to the console
  #A
  get __proto__() {
    try {
      this.#A ||= this.asString?.()
    } catch {}
    return super.__proto__
  }
}

class ClassType extends Type {
  static #nonNullCache = new WeakMap()
  static #nullableCache = new WeakMap()

  constructor(cl, nullable = false, generics = [], data = null, precomputedGenerics = null) {
    if (!cl.isClass) {
      console.log(cl)
      throw new Error("ClassType instantiated with value that is not a class")
    }

    let cacheable = !data && !generics.length, cache
    if (cacheable) {
      cache = nullable ? ClassType.#nullableCache : ClassType.#nonNullCache
      if (cache.has(cl)) return cache.get(cl)
    }

    super(nullable)

    if (cacheable) cache.set(cl, this)

    this.instanceOf = cl
    this.rawGenerics = generics
    this.data = data

    this.generics = precomputedGenerics || compiler.assignGenerics(cl, generics)
  }

  ////////////////////////////////

  getPropType(name) {
    let prop = this.instanceOf.getInstanceProp(name)

    if (!prop) {
      throw new error.TypeError(`Property '${name}' does not exist on type '${this.asString()}'`)
    }

    return prop.type
  }

  getPropAccessData(name) {
    let prop = this.instanceOf.getInstanceProp(name)

    if (!prop) {
      throw new Error(`Failed to get access data for property '${name}' of type '${this.asString()}'`)
    }

    return { access: prop.access, root: prop.root }
  }

  ////////////////////////////////

  get literalTypeName() {
    return this.instanceOf.value.literalTypeName
  }

  asNullable() {
    return this.nullable ? this : new ClassType(this.instanceOf, true, this.rawGenerics, this.data, this.generics)
  }

  is(cl, nullable = false, generics = []) {
    // optimization
    if (this.nullable && !nullable) return false
    if (!generics.length && !this.generics.length && cl === this.instanceOf) return true

    return super.is(cl, nullable, generics)
  }

  isFunction() {
    return this.instanceOf === compiler.lang.Function
  }

  isScoreboardCompatible() {
    return this.isRuntimeType() && Type.SCOREBOARD_COMPATIBLE.has(this.literalTypeName)
  }

  getNumberType() {
    return this.literalTypeName.replace("boolean", "byte")
  }

  isRuntimeType() {
    return !this.nullable
  }

  isFinal() {
    return !this.nullable && this.instanceOf.value.final
  }

  getGenericMap() {
    if (!this.generics.length) return null

    // TODO include superclass generics
    let { generics } = this.instanceOf.value
    return new Map(this.generics.map((value, i) => [generics[i], value]))
  }

  replaceGenerics(genericMap) {
    return new ClassType(this.instanceOf, this.nullable, this.rawGenerics.map(type => type.replaceGenerics(genericMap)), this.data)
  }

  _isSubtypeOf(type) {
    if (type instanceof GenericType || type instanceof VoidType || type.isNull()) {
      return false
    } else if (type instanceof UnionType) {
      return type.types.some(x => this.isSubtypeOf(x))
    } else if (type instanceof IntersectionType) {
      return type.types.every(x => this.isSubtypeOf(x))
    } else if (type instanceof TupleType) {
      return this.instanceOf === compiler.lang.Array
          && !type.minLength
          && this.generics[0].isSubtypeOf(type.middleTypeUnion)
    } else if (type instanceof ClassType) {
      let ownClass = this.instanceOf, ownGenerics = this.generics
      if (!ownClass.isSubclassOf(type.instanceOf)) return false
      if (!type.instanceOf.value.maxGenerics) return true

      while (ownClass !== type.instanceOf) {
        // TODO cache this
        ownGenerics = ownClass.traceGenericsToSuperclass(ownGenerics)
        ownClass = ownClass.value.superclass
        if (!ownClass) {
          throw new Error("ClassType.isSubtypeOf() - Failed to trace type to superclass")
        }
      }

      let otherGenerics = type.instanceOf.value.generics

      // TODO wrong? cause of optional generics
      if (ownGenerics.length !== otherGenerics.length) {
        throw new Error("ClassType.isSubtypeOf() - Resulting superclass generics array was of incorrect length")
      }

      return ownGenerics.every((ownType, i) => {
        let otherType = type.generics[i],
            variance = otherGenerics[i].variance

        return (variance === "in"  || ownType.isSubtypeOf(otherType))
            && (variance === "out" || otherType.isSubtypeOf(ownType))
      })
    } else {
      console.log(type)
      throw new Error("Invalid type passed to ClassType._isSubtypeOf()")
    }
  }

  asCompiledString() {
    return this.instanceOf.value.id
  }

  // should only be called for function types
  get paramTuple() {
    return this.generics[0]
  }
  #paramTypes
  get paramTypes() {
    let [type] = this.generics, paramTypes

    if (type.typeData) {
      // TODO needs to be much more robust (rest params, etc)
      paramTypes = type.typeData.map(data => data.type)
    } else {
      paramTypes = [{ rest: true, type }]
    }

    return this.#paramTypes ||= paramTypes
  }
  get returnType() {
    return this.generics[1]
  }
  paramTypeAt(i) {
    return this.paramTuple.typeAt(i)
  }

  asString(showNullable = true, parens = false) {
    if (this.instanceOf === compiler.lang.Object && this.nullable) return "unknown"

    let nullableMark = showNullable && this.nullable ? "?" : ""

    if (this.instanceOf === compiler.lang.Array) {
      let generic = this.generics[0].asString(true, true)
      if (!generic.endsWith(")")) return `${generic}[]${nullableMark}`
    }

    if (this.isFunction()) {
      let func = `${this.stringifyParams()} => ${this.returnType.asString(true, true)}`
      return addParens(func, parens || nullableMark) + nullableMark
    }

    let generics = Type.stringifyGenerics(this.rawGenerics)
    return `${this.literalTypeName || this.instanceOf.value.name}${generics}${nullableMark}`
  }

  asNamedString(name) {
    if (this.isFunction()) {
      return `${name}${this.stringifyParams(true)}: ${this.returnType.asString()}`
    } else {
      return super.asNamedString(name)
    }
  }

  stringifyParams(forceParens = false) {
    let str = this.paramTypes.map((type, i) => {
      let rest = false
      if (type.type) ({ type, rest } = type)

      let typeStr = type.asString(), name = this.data?.paramNames[i], restStr = rest ? "..." : ""
      return name ? `${restStr}${name}: ${typeStr}` : restStr + typeStr
    }).join(", ")

    return forceParens || this.paramTypes.length !== 1 || this.data?.paramNames[0] || this.paramTypes[0].rest
      ? `(${str})`
      : str
  }
}

class GenericType extends Type {
  static anonymousPlaceholder() {
    return "$" + compiler.id.anonGeneric()
  }

  // TODO cache?

  constructor(generic, nullable = false) {
    super(nullable || generic.extends.isNull())

    this.generic = generic
    this.hasNullableModifier = nullable
  }

  ////////////////////////////////

  getPropType(name) {
    try {
      return this.extends.getPropType(name)
    } catch (e) {
      throw e instanceof BaseError
        ? new error.TypeError(`Property '${name}' does not exist on generic type '${this.asDefinitionString()}'`, e)
        : e
    }
  }

  getPropAccessData(name) {
    return this.extends.getPropAccessData(name)
  }

  ////////////////////////////////

  get literalTypeName() {
    return this.extends.literalTypeName
  }

  get extends() { return this.generic.extends }
  get default() { return this.generic.default }

  asNullable() {
    return this.nullable ? this : new GenericType(this.generic, true)
  }

  isNull() {
    return this.extends.isNull()
  }

  maybeVoid() {
    return this.extends.maybeVoid()
  }

  replaceGenerics(genericMap) {
    // TODO maybe replace `extends` or `default`?
    return genericMap.get(this.generic) || this
  }

  _isSubtypeOf(type) {
    if (type instanceof GenericType) {
      return this.generic === type.generic
    } else if (type instanceof UnionType) {
      return type.types.some(x => this.isSubtypeOf(x))
    } else if (type instanceof IntersectionType) {
      return type.types.every(x => this.isSubtypeOf(x))
    } else {
      return this.extends.isSubtypeOf(type)
    }
  }

  asCompiledString() {
    // TODO
  }

  asString(showNullable = true) {
    // hasNullableModifier should never be true at definition sites, but just in case,
    // better to revert to normal stringification rules and display nullable marker
    if (this.generic.anonymous && !this.hasNullableModifier) {
      return `{${this.asDefinitionString()}}`
    }
    return `${this.generic.name}${showNullable && this.hasNullableModifier ? "?" : ""}`
  }

  // displays the generic with 'extends' clause
  asDefinitionString() {
    let str = this.generic.name
    if (this.generic.explicitExtends) str += ` extends ${this.extends.asString(true, true)}`
    // if (this.generic.explicitDefault) str += ` = ${this.default.asString(true, true)}`
    return str
  }
}

class UnionType extends Type {
  constructor(types, nullable = false) {
    if (!types.length) throw new Error("Attempted to create union type of zero types")

    let hasNullableModifier = nullable

    let isMaybeVoid = false, typeClass = null
    let processed = types.filter(type => {
      if (type instanceof NeverType) return false

      isMaybeVoid ||= type.maybeVoid()

      if (!typeClass) {
        typeClass = type.constructor
      } else if (typeClass !== type.constructor) {
        typeClass = true // true = multiple different classes
      }

      nullable ||= type.nullable
      return !type.isNull()
    })

    if (!processed.length) {
      return nullable ? new NullType() : new NeverType()
    } else if (processed.length === 1) {
      return nullable ? processed[0].asNullable() : processed[0]
    } else if (typeClass.singleton) {
      return new typeClass(nullable)
    }

    super(nullable)

    this.types = dedup(processed.flatMap(type => type instanceof UnionType ? type.types : type))
    this.rawTypes = types
    this.isMaybeVoid = isMaybeVoid
    this.hasNullableModifier = hasNullableModifier
  }

  ////////////////////////////////

  getPropType(name) {
    try {
      return new UnionType(this.types.map(type => type.getPropType(name)))
    } catch (e) {
      throw e instanceof BaseError
        ? new error.TypeError(`Property '${name}' does not exist on union type '${this.asString()}'`, e)
        : e
    }
  }

  getPropAccessData(name) {
    let first = this.types[0], data = first.getPropAccessData()

    for (let i = 1; i < this.types.length; i++) {
      let type = this.types[i], otherData = type.getPropAccessData()

      data.access = Math.min(data.access, otherData.access)

      if (otherData.root !== data.root) {
        throw new error.ReferenceError(`Cannot access multiple distinct properties from union type that happen to have the same name (property '${name}' of types '${first.asString()}' and '${type.asString()}')`)
      }
    }

    return data
  }

  ////////////////////////////////

  get literalTypeName() { return null }

  asNullable() {
    return this.nullable ? this : new UnionType(this.types, true)
  }

  maybeVoid() {
    return this.isMaybeVoid
  }

  replaceGenerics(genericMap) {
    return new UnionType(this.rawTypes.map(type => type.replaceGenerics(genericMap)), this.hasNullableModifier)
  }

  // TODO potentially override isSubtypeOf for janky edge cases like `never | never` (this specific one is impossible - see constructor)
  _isSubtypeOf(type) {
    return !type.isNull() && this.types.every(x => x.isSubtypeOf(type))
  }

  asCompiledString() {
    // TODO
  }

  asString(showNullable = true, parens = false) {
    let types = this.types.map(x => x.asString(false, true)).join(" | ")
    return addParens(showNullable && this.nullable ? `${types} | null` : types, parens)
  }
}

class IntersectionType extends Type {
  static #neverAndVoid
  static #neverAndVoidNullable

  constructor(types, nullable = false,
    // do not use 'skipAllChecks' unless necessary - also skips nullable checking so could produce invalid types in many ways
              skipAllChecks = false, maybeVoidOverride = false) {
    // TODO maybe just dont allow `void` in intersection types?

    if (skipAllChecks) {
      super(nullable)
      this.types = types
      this.isMaybeVoid = maybeVoidOverride
      this.hasNullableModifier = nullable
      return
    }

    if (!types.length) throw new Error("Attempted to create intersection type of zero types")

    if (types.length === 1) {
      return nullable ? types[0].asNullable() : types[0]
    }

    let hasNullableModifier = nullable

    let requireNull = false, requireNonNull = false, isMaybeVoid = true, requireVoidOrNull = false
    for (let type of types) {
      if (type instanceof VoidType) {
        requireNonNull ||= !type.nullable
        requireVoidOrNull = true
        continue
      }

      isMaybeVoid &&= type.maybeVoid()

      requireNull ||= type.isNull()
      requireNonNull ||= !type.nullable
    }

    nullable ||= !requireNonNull

    if (requireVoidOrNull) {
      if (isMaybeVoid) {
        return new VoidType(nullable)
      } else {
        return nullable
          ? (IntersectionType.#neverAndVoidNullable ||= new IntersectionType([new NeverType(), new VoidType()], true,  true, true))
          : (IntersectionType.#neverAndVoid         ||= new IntersectionType([new NeverType(), new VoidType()], false, true, true))
      }
    } else if (requireNull) {
      return nullable ? new NullType() : new NeverType()
    } else if (requireVoidOrNull) {
      return new VoidType(nullable)
    }

    super(nullable)

    this.types = dedup(types.flatMap(type => type instanceof IntersectionType ? type.types : type))
    this.isMaybeVoid = isMaybeVoid
    this.hasNullableModifier = hasNullableModifier
  }

  ////////////////////////////////

  getPropType(name) {
    try {
      return new IntersectionType(this.types.map(type => type.getPropType(name)))
    } catch (e) {
      throw e instanceof BaseError
        ? new error.TypeError(`Property '${name}' does not exist on intersection type '${this.asString()}'`, e)
        : e
    }
  }

  getPropAccessData(name) {
    // TODO make this less janky - probably only has a purpose once multiple inheritance/interfaces are implemented
    consoleWarn(`Getting properties from intersection types is currently very janky and unfinished - accessing '${name}' from type '${this.asString()}'`)

    let first = this.types[0], data = first.getPropAccessData()

    for (let i = 1; i < this.types.length; i++) {
      let type = this.types[i], otherData = type.getPropAccessData()

      data.access = Math.max(data.access, otherData.access)

      if (otherData.root !== data.root) {
        throw new error.ReferenceError(`Attempted to access conflicting properties of the same name from intersection type (property '${name}' of types '${first.asString()}' and '${type.asString()}')`)
      }
    }

    return data
  }

  ////////////////////////////////

  get literalTypeName() { return null }

  asNullable() {
    return this.nullable ? this : new IntersectionType(this.types, true)
  }

  maybeVoid() {
    return this.isMaybeVoid
  }

  replaceGenerics(genericMap) {
    return new IntersectionType(this.types.map(type => type.replaceGenerics(genericMap)), this.hasNullableModifier)
  }

  _isSubtypeOf(type) {
    if (type instanceof GenericType || type instanceof NullType) {
      return false
    } else {
      return this.types.some(x => x.isSubtypeOf(type))
    }
  }

  asString(showNullable = true, parens = false) {
    let types = this.types.map(x => x.asString(false, true)).join(" & ")
    return showNullable && this.nullable ? `(${types})?` : addParens(types, parens)
  }
}

class TupleType extends ClassType {
  constructor(types, nullable = false, arrayType = null) {
    let typeData = types.map(type => type instanceof Type ? { type, count: 1 } : type)
    let rawTypes = dedup(typeData.map(data => {
      let { type } = data
      if (type.maybeVoid()) {
        throw new error.TypeDefinitionError(`Tuple type cannot contain (potentially) void type '${type.asString()}'`)
      }
      return type
    }))

    // TODO really shouldn't extend ClassType at all
    let unionType = rawTypes.length ? new UnionType(rawTypes) : arrayType || new NeverType()
    super(compiler.lang.Array, nullable, [unionType])

    this.typeData = typeData
    this.rawTypes = rawTypes

    this.minLength = typeData.reduce((acc, { count }) => acc + count, 0)

    let left = [], variadic = false, leftI

    for (let i = 0; i < typeData.length; i++) {
      let data = typeData[i]

      if (data.variadic) {
        leftI = i
        variadic = true
        break
      }

      for (let j = 0; j < data.count; j++) left.push(data.type)
    }

    if (variadic) {
      this.middleTypeUnion = new UnionType(typeData.slice(leftI).map(data => data.type))
    //   let right = [], rightI
    //
    //   for (let i = typeData.length - 1; i >= 0; i--) {
    //     let data = typeData[i]
    //
    //     if (data.variadic) {
    //       rightI = i
    //       break
    //     }
    //
    //     for (let j = 0; j < data.count; j++) right.push(data.type)
    //   }
    //
    //   if (rightI < leftI) {
    //     throw new Error("Out of order left/right indices trying to evaluate tuple type")
    //   }
    //
    //   this.rightTypes = right
    //   // serves as a flag for whether this tuple type is variadic
    //   this.middleTypeUnion = new UnionType(typeData.slice(leftI, rightI + 1).map(data => data.type))
    // } else {
    //   this.rightTypes = left.toReversed()
    }

    this.leftTypes = left
    this.variadic = variadic
  }

  asNullable() {
    return new TupleType(this.typeData, true, !this.rawTypes.length ? this.generics[0] : null)
  }

  replaceGenerics(genericMap) {
    if (!this.rawTypes.length) return this

    return new TupleType(this.rawTypes.map(type => type.replaceGenerics(genericMap)), this.nullable)
  }

  _isSubtypeOf(type) {
    if (!(type instanceof TupleType)) {
      return super._isSubtypeOf(type)
    }

    if (this.minLength < type.minLength) return false

    // TODO maybe wrong if the variadic positions dont line up??

    let ownLTLen = this.leftTypes.length, otherLTLen = type.leftTypes.length
    // let ownRTLen = this.rightTypes.length, otherRTLen = type.rightTypes.length
    let ownUnion = this.middleTypeUnion, otherUnion = type.middleTypeUnion

    // TODO lots of duplicate checks for tuples with repeats like [int, int, int] ≤? [number, number, number]
    let leftLen = Math.min(
      this.variadic ? Infinity : ownLTLen,
      type.variadic ? Infinity : otherLTLen
    )
    if (leftLen === Infinity) {
      leftLen = Math.max(ownLTLen, otherLTLen)
    }
    for (let i = 0; i < leftLen; i++) {
      let own   = this.leftTypes[i] || ownUnion,
          other = type.leftTypes[i] || otherUnion

      if (!other) break
      if (!own?.isSubtypeOf(other)) return false
    }

    // TODO reinstate checking from right end
    //      - starting from end index of TYPE BEING ASSIGNED TO
    //      - actually correct for variadics - does this work? [byte, *int, long] !≤ [byte, int, long]

    // if (this.middleTypeUnion || type.middleTypeUnion) {
    //   let rightLen = Math.min(
    //     this.variadic ? Infinity : ownRTLen,
    //     type.variadic ? Infinity : otherRTLen
    //   )
    //   if (rightLen === Infinity) {
    //     rightLen = Math.max(ownRTLen, otherRTLen)
    //   }
    //   for (let i = 0; i < rightLen; i++) {
    //     let own   = this.rightTypes[i] || ownUnion,
    //         other = type.rightTypes[i] || otherUnion
    //
    //     if (!other) break
    //     if (!own?.isSubtypeOf(other)) return false
    //   }
    // }

    return !ownUnion || !otherUnion || ownUnion.isSubtypeOf(otherUnion)
  }

  typeAt(i) {
    return this.leftTypes[i]
  }

  itemAsString({ type, count, variadic }) {
    let base = type.asString()

    if (!count) {
      if (variadic) return "*" + base
      throw new Error("Non-variadic item of tuple type with 0 repeat count")
    } else if (count === 1) {
      return (variadic ? "+" : "") + base
    } else {
      return `${count}${variadic ? "+" : ""} ${base}`
    }
  }

  asString(showNullable = true) {
    return `[${this.typeData.map(this.itemAsString).join(", ")}]${showNullable && this.nullable ? "?" : ""}`
  }
}

class AnyType extends Type {
  static #instance
  static singleton = true

  constructor() {
    if (AnyType.#instance) return AnyType.#instance

    super(true)
    AnyType.#instance = this
  }

  ////////////////////////////////

  getPropType(name) {
    return this
  }

  getPropAccessData() {
    throw new error.ReferenceError("Cannot access properties from 'any' type. Cast to a more specific type first")
  }

  ////////////////////////////////

  get literalTypeName() {
    return "any"
  }

  asNullable() {
    return this
  }

  is() {
    return true
  }

  isSubtypeOf(type) {
    return !(type instanceof NeverType)
  }

  _isSubtypeOf() {
    throw new Error("AnyType._isSubtypeOf() should never be called")
  }

  asCompiledString() {
    // TODO
  }

  asString() {
    return "any"
  }
}

class NeverType extends Type {
  static #instance
  static singleton = true

  constructor(nullable = false) {
    if (nullable) return new NullType()

    if (NeverType.#instance) return NeverType.#instance

    super(false)
    NeverType.#instance = this
  }

  ////////////////////////////////

  getPropType(name) {
    throw new error.TypeError(`Property '${name}' does not exist on type 'never'`)
  }

  getPropAccessData(name) {
    throw new Error(`Attempted to access data for property '${name}' on 'never' type`)
  }

  ////////////////////////////////

  get literalTypeName() {
    return "never"
  }

  asNullable() {
    return new NullType()
  }

  isSubtypeOf() {
    return true
  }

  _isSubtypeOf() {
    throw new Error("NeverType._isSubtypeOf() should never be called")
  }

  asCompiledString() {
    // TODO
  }

  asString() {
    return "never"
  }
}

class NullType extends Type {
  static #instance
  static singleton = true

  constructor() {
    if (NullType.#instance) return NullType.#instance

    super(true)
    NullType.#instance = this
  }

  ////////////////////////////////

  getPropType(name) {
    throw new error.TypeError(`Property '${name}' does not exist on null`)
  }

  getPropAccessData(name) {
    throw new Error(`Attempted to access data for property '${name}' on 'null' type`)
  }

  ////////////////////////////////

  get literalTypeName() {
    return "null"
  }

  asNullable() {
    return this
  }

  isNull() {
    return true
  }

  isRuntimeType() {
    return true
  }

  isFinal() {
    return true
  }

  _isSubtypeOf(type) {
    return type.nullable
  }

  asCompiledString() {
    return "-1"
  }

  asString() {
    return "null"
  }
}

class VoidType extends Type {
  static #nonNullInstance
  static #nullableInstance
  static singleton = true

  constructor(nullable = false) {
    if (nullable) {
      if (VoidType.#nullableInstance) return VoidType.#nullableInstance
      super(true)
      VoidType.#nullableInstance = this
    } else {
      if (VoidType.#nonNullInstance) return VoidType.#nonNullInstance
      super(false)
      VoidType.#nonNullInstance = this
    }
  }

  getPropType(name) {
    throw new error.TypeError(`Cannot access property '${name}' from '${this.asString()}' type`)
  }

  getPropAccessData(name) {
    throw new Error(`Attempted to access data for property '${name}' on '${this.asString()}' type`)
  }

  ////////////////////////////////

  get literalTypeName() {
    return "void"
  }

  asNullable() {
    return this.nullable ? this : new VoidType(true)
  }

  maybeVoid() {
    return true
  }

  isSubtypeOf(type) {
    if (!type.maybeVoid()) return false
    if (this.nullable && !type.nullable) return false

    if (type instanceof VoidType) {
      return true
    } else if (type instanceof UnionType) {
      return type.types.some(x => this.isSubtypeOf(x))
    } else if (type instanceof IntersectionType) {
      return type.types.every(x => this.isSubtypeOf(x))
    } else {
      return false
    }
  }

  _isSubtypeOf() {
    throw new Error("VoidType._isSubtypeOf() should never be called")
  }

  asString(showNullable = true) {
    return showNullable && this.nullable ? "void?" : "void"
  }
}
