function setupDefaultVars(compiler) {
  let lines = []

  // TODO remove letter type
  function number(value, type, letterType) {
    return {
      type,
      value: compiler.compileExpression({
        type: "number",
        value,
        dataType: type,
        letterType
      }).str
    }
  }

  let literalTypes = compiler.literalTypes

  literalTypes.object = defaultClass(
    compiler,
    lines,
    "Object",
    {},
    {},
    {},
    {}
  )

  literalTypes.byte = defaultClass(
    compiler,
    lines,
    "Byte",
    {
      MIN_VALUE: number("-128", "byte", "b"),
      MAX_VALUE: number("127", "byte", "b"),
      BITS: number("8", "byte", "b"),
      BYTES: number("1", "byte", "b")
    },
    {},
    {},
    {},
    literalTypes.object
  )

  literalTypes.short = defaultClass(
    compiler,
    lines,
    "Short",
    {
      MIN_VALUE: number("-32768", "short", "s"),
      MAX_VALUE: number("32767", "short", "s"),
      BITS: number("16", "byte", "b"),
      BYTES: number("2", "byte", "b")
    },
    {},
    {},
    {},
    literalTypes.object
  )

  literalTypes.int = defaultClass(
    compiler,
    lines,
    "Integer",
    {
      MIN_VALUE: number("-2147483648", "int", ""),
      MAX_VALUE: number("2147483647", "int", ""),
      BITS: number("32", "byte", "b"),
      BYTES: number("4", "byte", "b")
    },
    {},
    {},
    {},
    literalTypes.object
  )

  literalTypes.long = defaultClass(
    compiler,
    lines,
    "Long",
    {
      MIN_VALUE: number("-9223372036854775808", "long", "l"),
      MAX_VALUE: number("9223372036854775807", "long", "l"),
      BITS: number("64", "byte", "b"),
      BYTES: number("8", "byte", "b")
    },
    {},
    {},
    {},
    literalTypes.object
  )

  literalTypes.float = defaultClass(
    compiler,
    lines,
    "Float",
    {
      BITS: number("32", "byte", "b"),
      BYTES: number("4", "byte", "b")
    },
    {},
    {},
    {},
    literalTypes.object
  )

  literalTypes.double = defaultClass(
    compiler,
    lines,
    "Double",
    {
      BITS: number("64", "byte", "b"),
      BYTES: number("8", "byte", "b")
    },
    {},
    {},
    {},
    literalTypes.object
  )

  literalTypes.string = defaultClass(
    compiler,
    lines,
    "String",
    {
      staticTest: {
        type: "int",
        value: "value 5s"
      }
    },
    {},
    {
      instanceTest: {
        type: "int",
        value: "value 10f"
      }
    },
    {},
    literalTypes.object
  )

  console.log("literalTypes", literalTypes)

  return lines
}

function defaultClass(compiler, lines, name, staticProps, staticMethods, instanceProps, instanceMethods, superclass = null) {
  let staticPropEntries = Object.entries(staticProps)
  for (let i of staticPropEntries) i[1].static = true

  for (let [propName, i] of staticPropEntries.concat(Object.entries(instanceProps))) {
    let id = i.id = compiler.nextId()

    lines.push(
      ...compiler.storeExpression(
        {
          str: i.value,
          extra: `# ${name}${i.static ? "" : ".__instance__"}.${propName}`
        },
        compiler.varStorage,
        id
      )
    )

    delete i.value
  }

  for (let i of [staticProps, staticMethods, instanceProps, instanceMethods])
    Object.setPrototypeOf(i, null)

  let { str, obj } = compiler.registerClass(name, staticProps, staticMethods, instanceProps, instanceMethods, superclass)

  lines.push(...str)

  return obj
}
