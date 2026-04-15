class BaseError extends Error {
  constructor(message, ...subErrors) {
    super()

    this.message = message
    for (let error of subErrors) {
      this.message += "\n  " + error.message.replaceAll("\n", "\n  ")
    }
  }
}

const error = {
  SyntaxError: class SyntaxError extends BaseError {},
  ValueError: class ValueError extends BaseError {},
  ReferenceError: class ReferenceError extends BaseError {},
  // type mismatch
  TypeError: class TypeError extends BaseError {},
  // like a variable reference error, but for type references
  TypeReferenceError: class TypeReferenceError extends BaseError {},
  // error when defining a type, for example supplying generics to a class
  TypeDefinitionError: class TypeDefinitionError extends BaseError {},
  // errors when defining a class
  ClassError: class ClassError extends BaseError {},
  RangeError: class RangeError extends BaseError {},
  CompileTimeEvaluationError: class CompileTimeEvaluationError extends BaseError {},
  // unimplemented language features
  UnimplementedError: class UnimplementedError extends BaseError {}
}
