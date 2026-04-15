class Environment {
  constructor(parent = null) {
    this.parent = parent
  }

  vars = Object.create(null)

  register(name, data, force = false) {
    if (this.getSelf(name) && !force)
      return false

    data.name = name

    data.usages = 0
    this.vars[name] = data

    return true
  }

  getSelf(name) {
    let variable = this.vars[name]

    if (!variable) return null

    variable.usages++
    return variable
  }

  get(name) {
    return this.getSelf(name) || (this.parent && this.parent.get(name))
  }

  getProp(obj, prop) {
    console.log(obj, prop)

    return obj.methods[prop] || obj.props[prop] || (obj.super && this.getProp(obj.super.classData, prop))
  }

  warnUnused() {
    for (let i in this.vars)
      if (!this.vars[i].usages)
        consoleWarn(`Unused variable '${i}'`)
  }
}
