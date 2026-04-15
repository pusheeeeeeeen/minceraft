class DataLocation {
  #location
  #name

  static storage(namespace, path) {
    return new this("storage", namespace, path)
  }

  static score(objective, name) {
    return new this("score", objective, name)
  }

  static void() {
    return new this("storage", `${names.namespace}:VOID`, "_") // TODO suboptimal
  }

  constructor(target, location, name) {
    this.target = target
    this.#location = location
    this.#name = name
  }

  get namespace() { return this.#location }
  get objective() { return this.#location }

  get path() { return this.#name }
  get name() { return this.#name }

  eq(loc) {
    return this.target === loc.target && this.#location === loc.namespace && this.#name === loc.path
  }

  asDataString() {
    if (this.target !== "storage") {
      throw new Error("Location.asDataString() called on a location with a non-'storage' target")
    }

    return `storage ${this.#location} ${this.#name}`
  }

  asScoreString() {
    if (this.target !== "score") {
      throw new Error("Location.asDataString() called on a location with a non-'score' target")
    }

    return `${this.#name} ${this.#location}`
  }

  asSubcommand() {
    if (this.target === "storage") {
      // TODO scale?
      return `run data get storage ${this.#location} ${this.#name}`
    } else if (this.target === "score") {
      return `run scoreboard players get ${this.#name} ${this.#location}`
    } else {
      this.throwMalformed()
    }
  }

  asTextComponent() {
    let obj

    if (this.target === "storage") {
      obj = { storage: this.#location, nbt: this.#name }
    } else if (this.target === "score") {
      obj = { score: { name: this.#name, objective: this.#location } }
    } else {
      this.throwMalformed()
    }

    return NBT.stringify(obj)
  }

  toString() {
    if (this.target === "storage") {
      return this.asDataString()
    } else if (this.target === "score") {
      return this.asScoreString()
    } else {
      this.throwMalformed()
    }
  }

  throwMalformed() {
    throw new Error("Malformed location - target must be either 'storage' or 'score'")
  }
}
