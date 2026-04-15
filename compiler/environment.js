class Environment {
  constructor(compileTimeParent = null, runtimeParent = null) {
    this.compileTimeParent = compileTimeParent
    this.runtimeParent = runtimeParent
  }

  vars = Object.create(null)

  // TODO should store either 1. compile time value, or 2. some sort of stack location
  registerVar(name, type, value, isConst = false) {
    if (!type && !value) {
      throw new Error("Environment.registerVar() called with neither type nor value")
    }

    type ||= value?.type

    let exprValues, location = null

    if (value instanceof Expression) {
      // re-create expression with correct type
      exprValues = value.values
      location = exprValues.storage?.location || exprValues.score?.location
      if (!location) {
        // TODO create location and return lines to move value to that location?
        throw new Error("Environment.registerVar() called with expression value without a location")
      }
    } else if (value instanceof Value) {
      if (!isConst) {
        throw new Error("Variables with a compile-time value must be const")
      }
      exprValues = { compileTimeValue: value }
    } else if (value !== null) {
      throw new Error("Environment.registerVar() called with value that is not an Expression, Value, or null")
    }

    this.vars[name] = {
      name,
      type,
      value: new Expression(type, exprValues),
      const: isConst,
      location
      // usages: 0
    }
  }

  getVar(name) {
    return this.getOwnVar(name) || this.runtimeParent?.getVar(name) || null
  }

  getOwnVar(name) {
    return this.vars[name]
  }

  // TODO very jank - move global vars out of stack entirely
  getVarExpression(name) {
    let variable = this.getVar(name)
    if (!variable) return null

    let expr = variable.value

    if (!this.isSameStack(variable)) {
      let { storage } = expr.values

      if (storage && !storage.location.path.startsWith("s[-1]")) {
        throw new Error("terrible global var hack is borked")
      }

      return new Expression(expr.type, {
        ...expr.values,
        storage: storage && {
          location: this.getVarLocation(variable),
          options: storage.options
        }
      })
    } else return expr
  }

  // jank continued...
  getVarLocation(variable, forceGlobal = null) {
    if ((forceGlobal ?? !this.isSameStack(variable)) && variable.location.target === "storage") {
      return DataLocation.storage(variable.location.namespace, variable.location.path.replace("s[-1]", "s[0]"))
    } else return variable.location
  }

  // jank continued...
  isSameStack(variable) {
    if (variable.name in this.vars) return true

    let env = this
    while ((env = env.runtimeParent) !== compiler.globalEnv) {
      if (variable.name in env.vars) return true
    }
  }

  // getOwnUnused() {
  //   return Object.values(this.vars).filter(x => !x.usages)
  // }

  types = Object.create(null)

  registerClassType(name, value) {
    this.types[name] = { class: value }
  }

  registerGenericType(name, obj) {
    this.types[name] = { generic: obj }
  }

  getType(name) {
    return this.getOwnType(name) || this.compileTimeParent?.getType(name) || null
  }

  getOwnType(name) {
    return this.types[name]
  }
}
