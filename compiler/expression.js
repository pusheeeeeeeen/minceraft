function concat(...values) {
  return values.flat(Infinity).filter(Boolean)
}

class Expression {
  static mergeOptions(a, b) {
    return {
      before: a?.before
        ? (b?.before ? a.before.concat(b.before) : a.before)
        : b?.before,
      temporary: !!(b ? b.temporary : a?.temporary)
    }
  }

  static compileTime(cl, value, nullable = false, generics = []) {
    let type = new ClassType(cl, nullable, generics)
    return new Expression(type, { compileTimeValue: new Value(type, value) })
  }

  static compileTimeNull(type = new NullType()) {
    return new Expression(type.asNullable(), { compileTimeValue: Value.null() })
  }

  static compileTimeThrow(type = new NeverType()) {
    return new Expression(type, {
      storage: {
        location: DataLocation.void(),
        options: {
          before: [compiler.throwNoMessage()]
        }
      }
    })
  }

  // TODO temporary (until refactor - see below)
  static void(sideEffects = null) {
    return new Expression(new VoidType(), { compileTimeValue: Value.null() }, sideEffects)
  }

  // TODO refactor (again) to only have one value
  //      with fields: location, compileTimeValue, before, flags: { contained, pure, overridable, temporary }
  //      subcommand format can probably begone or maybe could be encoded as a location?
  /*
  VALUES options:

  score: { location: Location, options?: { ... } }
  storage: { location: Location, options?: { ... } }
  subcommand: { str: "", success?: bool, options?: { ... } }
  compileTimeValue: Value

  options?: { before?: string[], temporary?: boolean, writable?: boolean }
  */
  constructor(type, values, sideEffects = null) {
    this.type = type
    this.values = values
    this.sideEffects = sideEffects

    if (type.isFinal()) {
      this.values.compileTimeValue ||= new Value(type)
    }

    this.compileTimeType = this.values.compileTimeValue?.type
    this.compileTimeValue = this.values.compileTimeValue?.value

    let { storage, score, subcommand } = values

    if (!(storage || score || subcommand || this.isCompileTime())) {
      this.throwMalformed()
    }
    if (storage && storage.location.target !== "storage") {
      this.throwMalformed("Location for 'values.storage' must have a target of 'storage'")
    }
    if (score && score.location.target !== "score") {
      this.throwMalformed("Location for 'values.score' must have a target of 'score'")
    }
    if ((score || subcommand) && !this.isScoreboardCompatible()) {
      this.throwMalformed("'values.score' and 'values.subcommand' can only be defined on scoreboard compatible expression types")
    }
  }

  RUNTIME_VALUES = ["score", "storage", "subcommand"]

  maybeVoid() {
    return this.type.maybeVoid()
  }

  isCompileTime() {
    return this.compileTimeValue !== undefined
  }

  isScoreboardCompatible() {
    return this.compileTimeType?.isScoreboardCompatible() || false
  }

  withType(type) {
    return new Expression(type, this.values, this.sideEffects)
  }

  setSideEffects(sideEffects) {
    if (!sideEffects?.length) return this

    let values = { compileTimeValue: this.values.compileTimeValue }

    for (let i of this.RUNTIME_VALUES) {
      let val = this.values[i]
      if (!val) continue

      values[i] = {
        ...val,
        options: {
          ...val.options,
          before: sideEffects
        }
      }
    }

    return new Expression(
      this.type,
      values,
      this.isCompileTime() ? sideEffects : null
    )
  }

  addSideEffects(sideEffects, before = false) {
    if (!sideEffects?.length) return this

    let values = { compileTimeValue: this.values.compileTimeValue }

    for (let i of this.RUNTIME_VALUES) {
      let val = this.values[i]
      if (!val) continue

      values[i] = {
        ...val,
        options: {
          ...val.options,
          before: before
            ? concat(sideEffects, val.options?.before)
            : concat(val.options?.before, sideEffects)
        }
      }
    }

    return new Expression(
      this.type,
      values,
      this.sideEffects || this.isCompileTime() ? (
        before
          ? concat(sideEffects, this.sideEffects)
          : concat(this.sideEffects, sideEffects)
      ) : null // TODO jank
    )
  }

  // withoutSideEffects() {
  //   let values = { compileTimeValue: this.values.compileTimeValue }
  //
  //   for (let i of this.RUNTIME_VALUES) {
  //     let val = this.values[i]
  //     if (!val) continue
  //
  //     values[i] = {
  //       ...val,
  //       options: {
  //         ...val.options,
  //         before: []
  //       }
  //     }
  //   }
  //
  //   return new Expression(
  //     this.type,
  //     values
  //   )
  // }

  replaceGenerics(genericMap) {
    return this.withType(this.type.replaceGenerics(genericMap))
  }

  ////////////////////////////////

  tryGetStaticProp(name) {
    if (!this.isCompileTime() || !this.type.is(compiler.lang.Class)) return null

    let prop = this.values.compileTimeValue.getStaticProp(name)
    return prop ? prop.getExpr : null
  }

  ////////////////////////////////

  /**
   * Should only be used as part of the <code>#debug.runtime()</code> compiler directive - does not change the effect
   * of the expression and only causes a performance hit
   */
  asUncertainDEBUG() {
    if (!this.values.compileTimeValue) return this

    let values = { ...this.values }
    delete values.compileTimeValue

    if (!Object.keys(values).length) {
      values.storage = this.#intoStorageObj(compiler.storageLoc())
      values.storage.options.before.unshift("# debug.runtime")

      // if (this.isScoreboardCompatible()) {
      //   values.score = this.#intoScoreObj(compiler.tempScoreboardLoc)
      //   values.compileTimeValue = new Value(this.compileTimeType)
      // }
    }

    return new Expression(this.type, values)
  }

  asPermanent(includeCompileTimeValue = true) {
    let values = {}, before, done = false

    for (let i of this.RUNTIME_VALUES) {
      let val = this.values[i]
      if (!val || val.options?.temporary) continue

      before = val.options?.before
      values[i] = { ...val }
      delete values[i].options

      done = true
      break
    }

    // TODO maybe preserve compileTimeType?
    if (includeCompileTimeValue && this.isCompileTime()) {
      values.compileTimeValue = this.values.compileTimeValue
    } else if (!done) {
      if (compiler.functionContext?.noRecurse && this.isScoreboardCompatible()) {
        ({ options: { before } = {}, ...values.score } = this.#intoScoreObj(compiler.scoreboardLoc()))
      } else {
        ({ options: { before } = {}, ...values.storage } = this.#intoStorageObj(compiler.storageLoc()))
      }
    }

    return [before, new Expression(this.type, values)]
  }

  getSideEffects() {
    if (this.sideEffects) return this.sideEffects

    let { storage, score, subcommand } = this.values

    return storage ? storage.options?.before
         : score ? score.options?.before
         : subcommand ? subcommand.options?.before
         : null
  }

  #compiledFromStr(str, location = null, ownOptions = null, options = null) {
    return new CompiledExpression(this.type, str, location, Expression.mergeOptions(ownOptions, options))
  }

  #compiledFromLoc(loc, ownOptions = null, options = null) {
    return this.#compiledFromStr(loc.toString(), loc, ownOptions, options)
  }

  #compiledFromObj(obj, options = null) {
    return this.#compiledFromLoc(obj.location, obj.options, options)
  }

  #storeCompileTimeToStorage(loc, valueOnly = false) {
    let value = this.values.compileTimeValue
    return [
      `data modify ${loc} set value ${valueOnly ? value.asSNBTValueOnly() : value.asSNBT()}`
    ]
  }

  #storeScoreToStorage(loc) {
    return [
      `data modify ${loc} set value ${this.type.asSNBT()}`,
      `execute store result ${loc}.v ${this.getNumberType()} 1 run scoreboard players get ${this.values.score.location}`
    ]
  }

  #storeSubcommandToStorage(loc, valueOnly = false) {
    let { subcommand } = this.values
    let storeType = subcommand.success ? "success" : "result"

    return valueOnly ? [
      `execute store ${storeType} ${loc} ${this.getNumberType()} 1 ${subcommand.str}`
    ] : [
      `data modify ${loc} set value ${this.type.asSNBT()}`,
      `execute store ${storeType} ${loc}.v ${this.getNumberType()} 1 ${subcommand.str}`
    ]
  }

  getNumberType() {
    return this.type.getNumberType()
  }

  #intoStorageObj(loc) {
    let before
    let { storage, score, subcommand } = this.values

    if (storage?.location.eq(loc)) {
      return storage
    }

    if (this.isCompileTime()) {
      before = this.#storeCompileTimeToStorage(loc)
    } else if (storage) {
      before = concat(
        storage.options?.before,
        `data modify ${loc} set from ${storage.location}`
      )
    } else if (score) {
      before = concat(
        score.options?.before,
        this.#storeScoreToStorage(loc)
      )
    } else if (subcommand) {
      before = concat(
        subcommand.options?.before,
        this.#storeSubcommandToStorage(loc)
      )
    } else this.throwMalformed()

    return { location: loc, options: { before } }
  }

  #intoScoreObj(loc) {
    let before
    let { compileTimeValue, score, storage, subcommand } = this.values

    if (score?.location.eq(loc)) {
      return score
    }

    if (this.isCompileTime()) {
      before = [
        `scoreboard players set ${loc} ${compileTimeValue.asScore()}`
      ]
    } else if (score) {
      before = concat(
        score.options?.before,
        `scoreboard players operation ${loc} = ${score.location}`
      )
    } else if (storage) {
      before = concat(
        storage.options?.before,
        `execute store result score ${loc} run data get ${storage.location}.v`
      )
    } else if (subcommand) {
      before = concat(
        ...subcommand.options?.before,
        `execute store ${subcommand.success ? "success" : "result"} score ${loc} ${subcommand.str}`
      )
    } else this.throwMalformed()

    return {
      location: loc,
      options: {
        before,
        temporary: loc === compiler.tempScoreboardLoc
      }
    }
  }

  intoStorage(loc, separateBefore = false) {
    if (loc.target !== "storage") {
      throw new Error("Expression.intoStorage() called with a location with a non-'storage' target")
    }

    let storage = this.#intoStorageObj(loc)

    if (separateBefore) {
      let before = storage.options?.before
      delete storage.options?.before

      return [
        before || [],
        new Expression(this.type, { storage })
      ]
    } else {
      return new Expression(this.type, { storage })
    }
  }

  intoScore(loc, separateBefore = false) {
    if (!this.isScoreboardCompatible()) {
      throw new Error("Expression.intoScore() called on expression that is not scoreboard compatible")
    }
    if (loc.target !== "score") {
      throw new Error("Expression.intoScore() called with a location with a non-'score' target")
    }

    let score = this.#intoScoreObj(loc)

    if (separateBefore) {
      let { before } = score.options
      delete score.options.before

      return [
        before || [],
        new Expression(this.type, { score })
      ]
    } else {
      return new Expression(this.type, { score })
    }
  }

  intoLocation(loc, separateBefore = false) {
    if (loc.target === "storage") {
      return this.intoStorage(loc, separateBefore)
    } else if (loc.target === "score") {
      return this.intoScore(loc, separateBefore)
    } else {
      loc.throwMalformed()
    }
  }

  // e.g. "storage a:b c"
  asDataString(loc = null) {
    let storage = !loc && this.values.storage || this.#intoStorageObj(loc || compiler.storageLoc())
    return this.#compiledFromObj(storage)
  }

  // for the second half of /data, e.g. "value ...", "from storage ...", "string storage ..."
  asExtendedDataString(loc = null) {
    if (this.isCompileTime()) {
      return this.#compiledFromStr(`value ${this.values.compileTimeValue.asSNBT()}`)
    }

    let asData = this.asDataString(loc)
    asData.str = `from ${asData.str}`
    return asData
  }

  asExtendedDataStringValueOnly(loc = null) {
    if (this.isCompileTime()) {
      return this.#compiledFromStr(`value ${this.values.compileTimeValue.asSNBTValueOnly()}`)
    }

    // TODO store only value instead of whole obj and accessing value - use valueOnly params
    let asData = this.asDataString(loc)
    asData.str = `from ${asData.str}.v`
    asData.location = null
    return asData
  }

  // e.g. "name compiler.vars"
  asScoreString(loc = null) {
    let score = !loc && this.values.score || this.#intoScoreObj(loc || compiler.tempScoreboardLoc)
    if (!this.values.score && !loc) {
      score.options.temporary = true
    }
    return this.#compiledFromObj(score)
  }

  asTextComponent() {
    let { score, storage, subcommand } = this.values

    // TODO more fancy stringification
    //  - true/false instead of 1b/0b
    //  - better array/object formatting?
    //  - should really be in toString() function, not hard-coded here

    if (this.isCompileTime()) {
      // TODO compile-time stringification
      let loc = compiler.storageLoc()
      return this.#compiledFromStr(
        loc.asTextComponent(),
        null,
        null,
        { before: this.#storeCompileTimeToStorage(loc, true) }
      )
    } else if (score) {
      return this.#compiledFromStr(
        score.location.asTextComponent(),
        null,
        score.options
      )
    } else if (storage) {
      let loc = storage.location
      return this.#compiledFromStr(
        DataLocation.storage(loc.namespace, loc.path + ".v").asTextComponent(),
        null,
        storage.options
      )
    } else if (subcommand) {
      let loc = compiler.storageLoc()
      return this.#compiledFromStr(
        loc.asTextComponent(),
        null,
        subcommand.options,
        { before: this.#storeSubcommandToStorage(loc, true) }
      )
    } else this.throwMalformed()
  }

  throwMalformed(msg = null) {
    msg ||= "must have at least one key in 'values' object"
          + (this.values.compileTimeValue && !this.isCompileTime() ? " excluding type-only compile-time value" : "")

    console.log(this.type.asString(), this.values)
    throw new Error(`Malformed expression - ${msg}`)
  }
}
