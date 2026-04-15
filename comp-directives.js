function setupCompDirectives(compiler) {
  function assertCompileTime(...args) {
    if (!args.slice(0, -1).every(x => x.isCompileTime())) {
      throw new error.CompileTimeEvaluationError(args[args.length - 1])
    }
  }

  let classes = compiler.lang

  let uint64Array = new BigUint64Array(1)

  const BINDABLE_TYPES = ["byte", "short", "int", "long", "float", "double", "boolean", "string"]

  compiler.compilerDirectives = {

    // DEBUGGING

    "debug.log": {
      params: [Type.unknown()],
      func(expression) {
        console.group("#debug.log")
        console.log("Type: ", expression.type.asString())
        if (expression.isCompileTime()) {
          let compileTime = expression.compileTimeValue
          let value = compileTime && typeof compileTime === "object"
            ? "..."
            : JSON.stringify(compileTime)
          if (value.length > 50) value = `${value.slice(0, 35)} ... ${value.slice(-10)}`

          console.groupCollapsed(`Compile-time value: %c${value}`, "font-family: Menlo, monospace; font-weight: normal;")
          console.log("Type: ", expression.compileTimeType.asString())
          console.log("Value: ", compileTime)
          console.log("SNBT: ", expression.values.compileTimeValue.asSNBTValueOnly())
          console.groupEnd()
        }
        console.log(expression)
        console.groupEnd()
        return expression
      }
    },

    "debug.logVarType": {
      params: [new ClassType(classes.String)],
      func(name) {
        assertCompileTime(name, "Variable name parameter of '#debug.logVarType' must be compile-time evaluable")

        name = name.compileTimeValue
        let variable = compiler.env.getVar(name)

        if (variable) {
          console.log(name, variable.type.asString(), variable.type)
        } else {
          console.log(`%cVariable '${name}' does not exist`, "font-style: italic;")
        }
      }
    },

    "debug.runtime": {
      params: [Type.unknown()],
      func(expression) {
        if (!expression.values.compileTimeValue) {
          consoleWarn("Compiler directive '#debug.runtime()' called on expression that is not compile-time evaluable")
          return expression
        }

        return expression.asUncertainDEBUG()
      }
    },

    // RNG

    "random.byte": {
      params: [new ClassType(classes.Byte), new ClassType(classes.Byte)],
      func(min, max) {
        assertCompileTime(min, max, "Min and max parameters of '#random.byte()' must be compile-time evaluable")

        min = min.compileTimeValue
        max = max.compileTimeValue

        if (min >= max) {
          throw new error.ValueError("Min parameter of '#random.byte()' must be less than max")
        }

        return Expression.compileTime(classes.Byte, Math.floor(Math.random() * (max - min)) + min)
      }
    },

    "random.short": {
      params: [new ClassType(classes.Short), new ClassType(classes.Short)],
      func(min, max) {
        assertCompileTime(min, max, "Min and max parameters of '#random.short()' must be compile-time evaluable")

        min = min.compileTimeValue
        max = max.compileTimeValue

        if (min >= max) {
          throw new error.ValueError("Min parameter of '#random.short()' must be less than max")
        }

        return Expression.compileTime(classes.Short, Math.floor(Math.random() * (max - min)) + min)
      }
    },

    "random.int": {
      params: [new ClassType(classes.Integer), new ClassType(classes.Integer)],
      func(min, max) {
        assertCompileTime(min, max, "Min and max parameters of '#random.int()' must be compile-time evaluable")

        min = min.compileTimeValue
        max = max.compileTimeValue

        if (min >= max) {
          throw new error.ValueError("Min parameter of '#random.int()' must be less than max")
        }

        return Expression.compileTime(classes.Integer, Math.floor(Math.random() * (max - min)) + min)
      }
    },

    "random.long": {
      params: [new ClassType(classes.Long), new ClassType(classes.Long)],
      func(min, max) {
        assertCompileTime(min, max, "Min and max parameters of '#random.long()' must be compile-time evaluable")

        min = min.compileTimeValue
        max = max.compileTimeValue

        if (min >= max) {
          throw new error.ValueError("Min parameter of '#random.long()' must be less than max")
        }

        let range = max - min, value

        if (range <= Number.MAX_SAFE_INTEGER) {
          value = BigInt(Math.floor(Math.random() * Number(range))) + min
        } else {
          let bitshift = Math.clz32(Number(range >> 32n))
          do {
            value = crypto.getRandomValues(uint64Array)[0] >>> bitshift
          } while (value > range)

          value += min
        }

        return Expression.compileTime(classes.Long, value)
      }
    },

    "random.float": {
      params: [new ClassType(classes.Float), new ClassType(classes.Float)],
      func(min, max) {
        assertCompileTime(min, max, "Min and max parameters of '#random.float()' must be compile-time evaluable")

        min = min.compileTimeValue
        max = max.compileTimeValue

        if (min >= max) {
          throw new error.ValueError("Min parameter of '#random.float()' must be less than max")
        }

        return Expression.compileTime(classes.Float, Math.fround(Math.random() * (max - min) + min))
      }
    },

    "random.double": {
      params: [new ClassType(classes.Double), new ClassType(classes.Double)],
      func(min, max) {
        assertCompileTime(min, max, "Min and max parameters of '#random.double()' must be compile-time evaluable")

        min = min.compileTimeValue
        max = max.compileTimeValue

        if (min >= max) {
          throw new error.ValueError("Min parameter of '#random.double()' must be less than max")
        }

        return Expression.compileTime(classes.Double, Math.random() * (max - min) + min)
      }
    },

    // MISC

    "comment": {
      params: [new ClassType(classes.String)],
      func(text) {
        assertCompileTime(text, "Comment text for '#comment()' directive must be compile-time evaluable")

        return Expression.void([`# ${text.compileTimeValue.replaceAll("\n", "\n# ")}`])
      }
    },

    "bind": {
      params: [new ClassType(classes.String), Type.unknownFunction()],
      func(idExpr, func) {
        assertCompileTime(idExpr, "Function identifier for '#bind()' directive must be compile-time evaluable")

        let id = idExpr.compileTimeValue
        if (!/^[a-z0-9_.-]+:([a-z0-9_.-]\/?)+$/.test(id)) {
          throw new error.ValueError(`Invalid function identifier '${id}'. Identifiers must be in the form 'namespace:path/to/function' and only contain the characters a-z 0-9 . _ -`)
        }

        let { paramTypes, returnType, data } = func.type, hasReturnVal = !(returnType instanceof VoidType)

        if (hasReturnVal && !returnType.isNull() && !BINDABLE_TYPES.includes(returnType.literalTypeName)) {
          throw new error.TypeError(`Return type of bound functions must be one of: ${BINDABLE_TYPES.join(", ")}, null, void`)
        }

        let paramNBT = paramTypes.map((type, i) => {
          if (!type.isRuntimeType() || !BINDABLE_TYPES.includes(type.literalTypeName)) {
            throw new error.TypeError(`Parameter types of bound functions must be one of: ${BINDABLE_TYPES.join(", ")}`)
          }

          let name = data?.paramNames[i]
          if (!name) {
            throw new error.ValueError("Parameters of bound functions must be named")
          }

          // FIXME escape macro values - quotes for strings, etc.
          // TODO macro type checking/casting?
          return `{${type.asSNBTProperties()},v:$(${name})}`
        })

        compiler.registerFunction(concat(
          compiler.setReturnFlags(compiler.returnFlags.NONE),
          `data modify ${compiler.functionArgLoc(true)} set value [${paramNBT}]`,
          compiler.callFunctionExpression(func, false),
          hasReturnVal ? [
            `data modify storage ${id} return set from ${compiler.functionReturnLoc}.v`, // TODO jank
            `execute unless score ${names.returnFlagScoreboard} matches ${compiler.returnFlags.THROW} run return run data get ${compiler.functionReturnLoc}.v`
          ] : [
            `execute unless score ${names.returnFlagScoreboard} matches ${compiler.returnFlags.THROW} run return 1`
          ],
          `tellraw @s ${NBT.stringify({ text: "womp womp (it threw an error)", color: "red" })}`, // TODO better error message - print the error
          `return fail`
        ), id)
      }
    },

    "tick": {
      params: [new ClassType(classes.Function)],
      func(func) {
        if (func.isCompileTime()) {
          compiler.addTickingFunction(func.compileTimeValue.id)
        } else {
          compiler.addTickingFunction(compiler.registerFunction(compiler.callFunctionExpression(func, false).getSideEffects()))
        }
      }
    },

    "schedule": {
      params: [new ClassType(classes.Function), new ClassType(classes.Double)],
      func(func, delay) { // TODO inconsistent ordering with #bind() ???
        assertCompileTime(func, delay, "Function and delay for '#schedule()' directive must be compile-time evaluable")

        delay = delay.compileTimeValue
        if (delay < 0) {
          throw new error.ValueError("Cannot schedule function with a negative delay")
        }

        return Expression.void([`schedule function ${func.compileTimeValue.id} ${delay}s`])
      }
    },

    "isCompiletime": {
      params: [Type.unknown()],
      func(expression) {
        return Expression.compileTime(classes.Boolean, expression.isCompileTime())
      }
    },

    "assertCompiletime": {
      params: [Type.unknown(), new ClassType(classes.String, true)],
      func(expression, msgExpression) {
        let msg

        if (!(msgExpression.type.isNull())) {
          assertCompileTime(msgExpression, "Error message parameter of '#assertCompiletime()' must be compile-time evaluable")
          msg = msgExpression.compileTimeValue
        } else {
          msg = "Compile-time assertion failed"
        }

        assertCompileTime(expression, msg)

        return expression
      }
    },

    "log": {
      params: [new ClassType(classes.String)],
      func(expression) {
        assertCompileTime(expression, "Message parameter of '#log()' must be compile-time evaluable")
        consoleLog(expression.compileTimeValue)
      }
    },

    // CONSTANTS

    "name": {
      func() {
        return Expression.compileTime(classes.String, compiler.name)
      }
    },

  }

  for (let i of Object.values(compiler.compilerDirectives)) {
    if (i.params) {
      i.minParams = i.params.findLastIndex(type => !type.nullable) + 1
      i.maxParams = i.params.length
    }
  }
}
