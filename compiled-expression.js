class CompiledExpression {
  constructor(type, str, location = null, options = {}) {
    this.type = type
    this.str = str
    this.location = location
    this.options = options
  }

  toString() {
    throw new Error("Must use Compiler.join`` or Compiler.joinToObj`` with CompiledExpression instances")
  }
}
