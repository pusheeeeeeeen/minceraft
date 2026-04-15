const Access = { PRIVATE: 0, PROTECTED: 1, PUBLIC: 2 }

const accessLevelNames = ["private", "protected", "public"]
function stringifyAccess(access) {
  return accessLevelNames[access]
}

function setupDefaults(compiler) {
  let before = []

  function register(name, superclass, generics, final = false, literalTypeName = null) {
    return compiler.registerClass(name, superclass, generics, final, null, literalTypeName)
  }

  function setFields(cl, staticProps, instanceProps) {
    setPropDefaults(staticProps, false)
    setPropDefaults(instanceProps, true)

    let lines = compiler.setClassFields(cl, staticProps, instanceProps)
    before.push(...lines) // TODO faster to push whole array and .flat() at the end?
  }

  function setPropDefaults(props, instance) {
    for (let name in props) {
      let prop = props[name]

      if (prop.value) {
        if (prop.writable) {
          throw new Error("Property with .value cannot be writable")
        }
        if (!prop.value.hasValue) {
          throw new Error("Property with .value must contain an actual value, not just a type")
        }
        prop.type ||= prop.value.type
      } else {
        if (prop.shared && !prop.expr) {
          throw new Error("Shared property must have .value or (.type and .expr)")
        }
        prop.type ||= prop.expr.type
      }
      prop.access ??= Access.PUBLIC
      prop.writable ||= false
      if (instance) {
        prop.shared ||= false
        prop.final ||= false
      }

      if ((prop.access === Access.PUBLIC) === name.startsWith("#")) {
        throw new Error(`Invalid name '${name}' for ${stringifyAccess(prop.access)} property. Public properties cannot start with '#', private/protected must`)
      }
    }
  }

  function func(value, generics) {
    generics = generics.map(type => type instanceof Value ? new ClassType(type) : type)

    return {
      value: Value.instance(classes.Function, value, false, generics),
      shared: true
    }
  }

  let classes = compiler.lang, generics = compiler.langGenerics

  /*
  FIELD FORMAT

  {
    value: Value   OR   expr: Expression   OR   neither* :(
    type?: Type
    access?: Access (default PUBLIC)
    writable?: boolean (default false)

  instance fields only:
    shared?: boolean (default false)
    final?: boolean (default false)
  }

  * TODO require initialization in constructor (before any 'this' access?)

  */

  // ============ BASIC ============ //

  // bootstrapping placeholder - fixed later
  // registerClass requires that the 'class' type is already defined
  classes.Class = new Value({ isRuntimeType() { return true } }, { generics: [], name: "__ClassPlaceholder__" })
  classes.Class.type.instanceOf = classes.Class
  classes.Class.type = new ClassType(classes.Class)

  classes.Object = register("Object", null, [], false)

  classes.Class = register("Class", classes.Object, [], true)

  // fix types of base classes
  classes.Object.type.instanceOf = classes.Class
  classes.Class.type.instanceOf = classes.Class

  classes.String = register("String", classes.Object, [], true, "string")

  classes.Boolean = register("Boolean", classes.Object, [], true, "boolean")

  classes.Number = register("Number", classes.Object, [], false, "number") // TODO make interface or abstract or sealed or something idk
  classes.Byte = register("Byte", classes.Number, [], true, "byte")
  classes.Short = register("Short", classes.Number, [], true, "short")
  classes.Integer = register("Integer", classes.Number, [], true, "int")
  classes.Long = register("Long", classes.Number, [], true, "long")
  classes.Float = register("Float", classes.Number, [], true, "float")
  classes.Double = register("Double", classes.Number, [], true, "double")

  let arrayIndexType = Type.union(classes.Byte, classes.Short, classes.Integer)
  generics.Array_T = { name: "T" }
  classes.Array = register("Array", classes.Object, [generics.Array_T], true)

  generics.Function_Args = { name: "Args", rest: true, variance: "in" }
  generics.Function_Return = { name: "Return", variance: "out", extends: Type.unknownOrVoid() }
  classes.Function = register("Function", classes.Object, [generics.Function_Args, generics.Function_Return], true)

  setFields(
    classes.Class,
    {},
    {
      getName: func({
        func([self]) {
          if (self.compileTimeValue) {
            return Expression.compileTime(classes.String, self.compileTimeValue.name)
          } else {
            // TODO runtime getName()
            return Expression.compileTime(classes.String, "TODO - Class.getName()")
          }
        }
      }, [classes.Class, classes.String])
    }
  )

  setFields(
    classes.Object,
    {},
    {
      test: {
        value: Value.instance(classes.Integer, 123)
      }
    }
  )

  setFields(
    classes.Function,
    {},
    {
      // TODO broken - something with spread generics is very wonky
      // call: func({
      //   func([self, ...args]) {
      //     return compiler.compileFunctionCall(self, args)
      //   }
      // }, [
      //   classes.Function,
      //   { spread: true, type: new GenericType(generics.Function_Args) },
      //   new GenericType(generics.Function_Return)
      // ])
    }
  )

  setFields(
    classes.String,
    {},
    {
      length: func({
        func([self]) {
          if (self.isCompileTime()) {
            return Expression.compileTime(classes.Integer, self.compileTimeValue.length)
          } else {
            let subcommand = Compiler.joinToSubcommandObj`run data get ${self.asDataString()}.v`
            subcommand.options.temporary = true
            return new Expression(new ClassType(classes.Integer), { subcommand })
          }
        }
      }, [classes.String, classes.Integer])
    }
  )

  setFields(
    classes.Boolean,
    {},
    {
      toString: func({
        func([self]) {
          if (self.isCompileTime()) {
            return Expression.compileTime(classes.String, self.compileTimeValue ? "true" : "false")
          } else {
            // TODO runtime boolean toString
            return Expression.compileTime(classes.String, "TODO - Boolean.toString()")
          }
        }
      }, [classes.Boolean, classes.String])
    }
  )

  setFields(
    classes.Number,
    {},
    {
      toString: func({
        func([self]) {
          if (self.isCompileTime()) {
            // TODO number stringification rules are slightly different in JS
            return Expression.compileTime(classes.String, self.compileTimeValue.toString())
          } else {
            // TODO runtime number toString (make sure to exclude type qualifier - 10b -> "10")
            return Expression.compileTime(classes.String, "TODO - Number.toString()")
          }
        }
      }, [classes.Number, classes.String])
    }
  )

  setFields(
    classes.Byte,
    {
      MIN_VALUE: {
        value: Value.instance(classes.Byte, NUMBER_RANGES.byte.min)
      },
      MAX_VALUE: {
        value: Value.instance(classes.Byte, NUMBER_RANGES.byte.max)
      }
    },
    {}
  )

  setFields(
    classes.Short,
    {
      MIN_VALUE: {
        value: Value.instance(classes.Short, NUMBER_RANGES.short.min)
      },
      MAX_VALUE: {
        value: Value.instance(classes.Short, NUMBER_RANGES.short.max)
      }
    },
    {}
  )

  setFields(
    classes.Integer,
    {
      MIN_VALUE: {
        value: Value.instance(classes.Integer, NUMBER_RANGES.int.min)
      },
      MAX_VALUE: {
        value: Value.instance(classes.Integer, NUMBER_RANGES.int.max)
      }
    },
    {}
  )

  setFields(
    classes.Long,
    {
      MIN_VALUE: {
        value: Value.instance(classes.Long, NUMBER_RANGES.long.min)
      },
      MAX_VALUE: {
        value: Value.instance(classes.Long, NUMBER_RANGES.long.max)
      }
    },
    {}
  )

  setFields(
    classes.Float,
    {
      MIN_VALUE: {
        value: Value.instance(classes.Float, NUMBER_RANGES.float.min)
      },
      MAX_VALUE: {
        value: Value.instance(classes.Float, NUMBER_RANGES.float.max)
      }
    },
    {}
  )

  setFields(
    classes.Double,
    {
      MIN_VALUE: {
        value: Value.instance(classes.Double, NUMBER_RANGES.double.min)
      },
      MAX_VALUE: {
        value: Value.instance(classes.Double, NUMBER_RANGES.double.max)
      }
    },
    {}
  )

  const Array_T = new GenericType(generics.Array_T)

  setFields(
    classes.Array,
    {
      fromLength: func({
        func([length, fillValue]) {
          if (!length.isCompileTime()) {
            throw new error.UnimplementedError("Length for Array.fromLength() must be compile-time evaluable")
          }

          let len = length.compileTimeValue

          let [fillSNBT, fillAsData] = len <= 16 && fillValue.isCompileTime() // don't repeat it too many times
            ? [fillValue.values.compileTimeValue.asSNBT(), null]
            : ["0b", fillValue.asExtendedDataString()]

          return compiler.instantiateArrayWithBefore(Type.unknown(), concat(
            fillAsData?.options.before,
            `data modify ${compiler.tempArrayDataLoc()} set value [${Array(len).fill(fillSNBT)}]`,
            fillAsData && `data modify ${compiler.tempArrayDataLoc()}[] set ${fillAsData.str}`
          ))
        }
      }, [
        classes.Integer,
        Type.unknown(),
        new ClassType(classes.Array, false, [Type.unknown()])
      ])
    },
    {
      length: {
        type: new ClassType(classes.Integer)
      },

      get: func({
        func([self, index]) {
          if (index.isCompileTime() && self.isCompileTime()) {
            // TODO untested - compiletime arrays currently never exist
            let i = index.compileTimeValue
            if (i < 0) i += self.compileTimeValue.length

            if (i < 0 || i >= self.compileTimeValue.length) {
              consoleWarn(`Array index '${i}' is always out of bounds`)
              return Expression.compileTimeThrow(Array_T)
            }
            return new Expression(Array_T, {
              compileTimeValue: self.compileTimeValue[i]
            })
          }

          let id = compiler.arrayGetFunc ||= compiler.registerFunction([
            `execute unless data storage ${names.heapStorage} $(p)._data[$(i)] run ${compiler.throwNoMessage()}`,
            `data modify ${compiler.tempStorageLoc} set from storage ${names.heapStorage} $(p)._data[$(i)]`
          ], "_a_g")

          let arrPtrVal = self.asExtendedDataStringValueOnly()

          return new Expression(
            Array_T,
            {
              storage: {
                location: compiler.tempStorageLoc,
                options: {
                  temporary: true,
                  before: concat(
                    arrPtrVal.options.before,
                    Compiler.join`data modify storage ${names.macroStorage} i set ${index.asExtendedDataStringValueOnly()}`,
                    `data modify storage ${names.macroStorage} p set ${arrPtrVal.str}`,
                    compiler.fullFunctionCommand(`function ${id} with storage ${names.macroStorage}`, {})
                  )
                }
              }
            }
          )
        }
      }, [
        new ClassType(classes.Array, false, [Array_T]),
        arrayIndexType,
        Array_T
      ]),

      set: func({
        func([self, index, value]) {
          if (self.isCompileTime()) {
            throw new Error("Trying to set to compile-time array")
          }

          let id = compiler.arraySetFunc ||= compiler.registerFunction([
            `execute unless data storage ${names.heapStorage} $(p)._data[$(i)] run ${compiler.throwNoMessage()}`,
            `data modify storage ${names.heapStorage} $(p)._data[$(i)] set from ${compiler.tempStorageLoc}`
          ], "_a_s")

          let arrPtrVal = self.asExtendedDataStringValueOnly(), arrIdxVal = index.asExtendedDataStringValueOnly()

          return new Expression(
            Array_T,
            {
              storage: {
                location: compiler.tempStorageLoc,
                options: {
                  temporary: true,
                  before: concat(
                    arrPtrVal.options.before,
                    arrIdxVal.options.before,
                    value.intoStorage(compiler.tempStorageLoc, true)[0],
                    `data modify storage ${names.macroStorage} i set ${arrIdxVal.str}`,
                    `data modify storage ${names.macroStorage} p set ${arrPtrVal.str}`,
                    compiler.fullFunctionCommand(`function ${id} with storage ${names.macroStorage}`, {})
                  )
                }
              }
            }
          )
        }
      }, [
        new ClassType(classes.Array, false, [Array_T]),
        arrayIndexType,
        Array_T,
        new VoidType()
      ])
    }
  )

  // ============ WORLD ============ //

  classes.World = register("World", classes.Object, [], true)
  classes.BlockPos = register("BlockPos", classes.Object, [], true)

  let blockSetFunc = compiler.registerFunction([
    `setblock $(x) $(y) $(z) $(b)`
  ])

  let blockFillXYZXYZFunc = compiler.registerFunction([
    `fill $(x) $(y) $(z) $(x2) $(y2) $(z2) $(b)`
  ])
  let blockFillXYZWHDFunc = compiler.registerFunction([
    `execute positioned $(x) $(y) $(z) run fill ~ ~ ~ ~$(w) ~$(h) ~$(d) $(b)`
  ])

  setFields(
    classes.World,
    {
      pos: func({
        func([x, y, z]) {
          let [before, blockPos] = compiler.instantiate(classes.BlockPos, []).asPermanent() // TODO use args for x, y, z
          return blockPos.addSideEffects(concat(
            before,
            compiler.setProperty(blockPos, "x", x, true),
            compiler.setProperty(blockPos, "y", y, true),
            compiler.setProperty(blockPos, "z", z, true)
          ))
        }
      }, [
        classes.Integer,
        classes.Integer,
        classes.Integer,
        classes.BlockPos
      ]),
      setBlock: func({
        func(args) {
          let compiled = args.map(expr => expr.asExtendedDataStringValueOnly())

          return Expression.void(concat(
            compiled.map(x => x.options.before),
            ["x", "y", "z", "b"].map(
              (name, i) => `data modify storage ${names.macroStorage} ${name} set ${compiled[i].str}`
            ),
            `function ${blockSetFunc} with storage ${names.macroStorage}`
          ))
        }
      }, [
        classes.Integer,
        classes.Integer,
        classes.Integer,
        classes.String,
        new VoidType()
      ]),
      fillBlocks: func({
        func(args) {
          let compiled = args.map(expr => expr.asExtendedDataStringValueOnly())

          return Expression.void(concat(
            compiled.map(x => x.options.before),
            ["x", "y", "z", "x2", "y2", "z2", "b"].map(
              (name, i) => `data modify storage ${names.macroStorage} ${name} set ${compiled[i].str}`
            ),
            `function ${blockFillXYZXYZFunc} with storage ${names.macroStorage}`
          ))
        }
      }, [
        classes.Integer,
        classes.Integer,
        classes.Integer,
        classes.Integer,
        classes.Integer,
        classes.Integer,
        classes.String,
        new VoidType()
      ]),
      // TODO subtract one from size
      fillBlocksSized: func({
        func(args) {
          let compiled = args.map(expr => expr.asExtendedDataStringValueOnly())

          return Expression.void(concat(
            compiled.map(x => x.options.before),
            ["x", "y", "z", "w", "h", "d", "b"].map(
              (name, i) => `data modify storage ${names.macroStorage} ${name} set ${compiled[i].str}`
            ),
            `function ${blockFillXYZWHDFunc} with storage ${names.macroStorage}`
          ))
        }
      }, [
        classes.Integer,
        classes.Integer,
        classes.Integer,
        classes.Integer,
        classes.Integer,
        classes.Integer,
        classes.String,
        new VoidType()
      ])
    },
    {}
  )

  setFields(
    classes.BlockPos,
    {},
    {
      // TODO maybe long?
      x: {
        type: new ClassType(classes.Integer)
      },
      y: {
        type: new ClassType(classes.Integer)
      },
      z: {
        type: new ClassType(classes.Integer)
      },
      setBlock: func({
        func([self, block]) {
          let compiled = [
            compiler.getProperty(self, "x"),
            compiler.getProperty(self, "y"),
            compiler.getProperty(self, "z"),
            block
          ].map(expr => expr.asExtendedDataStringValueOnly())

          return Expression.void(concat(
            compiled.map(x => x.options.before),
            ["x", "y", "z", "b"].map(
              (name, i) => `data modify storage ${names.macroStorage} ${name} set ${compiled[i].str}`
            ),
            `function ${blockSetFunc} with storage ${names.macroStorage}`
          ))
        }
      }, [
        classes.BlockPos,
        classes.String,
        new VoidType()
      ])
    }
  )

  return before
}
