const NBT = new class {
  UNQUOTED_KEY_REGEX = /^[a-z0-9_+-]+$/i // TODO split into compound decl vs. path (paths allow lots more unquoted chars)
  UNQUOTED_STRING_REGEX = /^[a-z_][a-z0-9_.+-]*$/i

  quotesOptional(str) {
    return this.UNQUOTED_STRING_REGEX.test(str) && str !== "true" && str !== "false"
  }

  BYTE = Symbol("NBT.Byte")
  SHORT = Symbol("NBT.Short")
  INT = Symbol("NBT.Int")
  LONG = Symbol("NBT.Long")
  FLOAT = Symbol("NBT.Float")
  DOUBLE = Symbol("NBT.Double")

  #numberTypes = new Map([
    [this.BYTE, "b"],
    [this.SHORT, "s"],
    [this.INT, "i"],
    [this.LONG, "l"],
    [this.FLOAT, "f"],
    [this.DOUBLE, "d"]
  ])

  #typedArrayClasses = new Map([
    [Int8Array, "b"],
    // no 'short array' tag
    [Int32Array, "i"],
    [BigInt64Array, "l"]
  ])

  stringify(obj, pretty = false) {
    return this.#stringify(obj, false, pretty)
  }

  stringifyInlineStrings(obj, pretty = false) {
    return this.#stringify(obj, true, pretty)
  }

  #stringify(obj, noQuotes, pretty) {
    let type = typeof obj

    if (obj == null) {
      throw new Error(`Unexpected ${obj} while stringifying NBT`)
    } else if (type === "number" || type === "bigint") {
      throw new Error(`Unexpected number ${obj} while stringifying NBT. Number type must be specified using [1, NBT.INT], or for arrays [NBT.INT, 1, 2, 3]`)
    }

    let space = pretty ? " " : ""

    if (type === "string") {
      let noQ = noQuotes || (!pretty && this.quotesOptional(obj))
      return noQ ? obj : `"${this.escape(obj)}"`
    } else if (type === "boolean") {
      return pretty
        ? (obj ? "true" : "false")
        : (obj ? "1b" : "0b")
    } else if (Array.isArray(obj)) {
      if (this.#numberTypes.has(obj[1])) {
        return obj[0] + this.#numberTypes.get(obj[1])
      }

      let items

      if (this.#numberTypes.has(obj[0])) {
        let ending = this.#numberTypes.get(obj[0])
        items = obj.slice(1).map(n => n + ending)
      } else {
        items = obj.map(o => this.#stringify(o, noQuotes, pretty))
      }

      return `[${items.join("," + space)}]`
    } else if (this.#typedArrayClasses.has(obj.constructor)) {
      let type = this.#typedArrayClasses.get(obj.constructor)
      // return `[${type.toUpperCase()};${space}${obj.join(type + "," + space)}${type}]`   no longer necessary to specify individual num type
      return `[${type.toUpperCase()};${space}${obj.join("," + space)}]`
    } else if (type === "object") {
      let entries = Object.entries(obj).map(
        ([k, v]) => `${this.key(k)}:${space}${this.#stringify(v, noQuotes, pretty)}`
      )
      return `{${entries.join("," + space)}}`
    }

    console.log(obj)
    throw new Error(`Unexpected value (${obj}) while stringifying NBT`)
  }

  key(key) {
    return this.UNQUOTED_KEY_REGEX.test(key) ? key : `"${this.escape(key)}"`
  }

  escape(str) {
    return str.replaceAll("\\", "\\\\")
              .replaceAll('"', '\\"')
              .replaceAll("\n", "\\n")
              .replaceAll("\t", "\\t")
              .replaceAll("$(", "$\\(") // TODO check if this works and is correct in quoted compound keys
  }
}
