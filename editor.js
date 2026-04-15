function id(id) { return document.getElementById(id) }
function query(q) { return document.querySelector(q) }

const input = id("input"),
      fileOutput = id("files"),
      outputOuter = id("output"),
      outputResizer = query("#right .resize"),
      consoleOuter = id("console"),
      consoleResizer = query("#bottom .resize"),
      resizePageCover = id("resize-cover")

function snapResize(size, min, max) {
  return size < min / 2 ? 0 : Math.min(max, Math.max(size, min))
}

let consoleResizePos = null, consoleResizeHeight = null

consoleResizer.onmousedown = e => {
  consoleResizePos = e.pageY
  consoleResizeHeight = consoleOuter.offsetHeight

  resizePageCover.classList.add("resizing")
  resizePageCover.style.cursor = "row-resize"
}

let outputResizePos = null, outputResizeWidth = null

outputResizer.onmousedown = e => {
  outputResizePos = e.pageX
  outputResizeWidth = outputOuter.offsetWidth

  resizePageCover.classList.add("resizing")
  resizePageCover.style.cursor = "col-resize"
}

onmousemove = e => {
  if (consoleResizePos !== null)
    consoleOuter.style.height = snapResize(consoleResizePos - e.pageY + consoleResizeHeight, 50, innerHeight - 100) + "px"

  if (outputResizePos !== null)
    outputOuter.style.width = snapResize(outputResizePos - e.pageX + outputResizeWidth, 100, innerWidth - 200) + "px"
}

onmouseup = () => {
  consoleResizePos = consoleResizeHeight = outputResizePos = outputResizeWidth = null
  resizePageCover.classList.remove("resizing")
}

input.oninput = () => {
  localStorage.setItem("code", input.value)
  compiled = null
}

input.value = localStorage.getItem("code") || ""

let projectName = "TEST"

id("compile").onclick = compile
id("download").onclick = download

let path = (location.origin + location.pathname).slice(0, -"index.html".length)

let compiled = null

function compile() {
  clearConsole()
  consoleLog("Compiling code...")

  if (consoleOuter.offsetHeight < 200)
    consoleOuter.style.height = "200px"

  let start = performance.now()

  let code = input.value

  try {
    compiled = new Compiler(code, projectName).run()
  } catch (e) {
    if (e instanceof BaseError) {
      consoleError(e.constructor.name, e.message)
      console.log(e)
    } else {
      consoleProblem(`${e.line}:${e.column || "?"} ${e}\n\n${e.stack.replaceAll(path, "")}`)
    }

    return
  }

  let end = performance.now()

  fileOutput.innerHTML = ""

  for (let id in compiled.functions) {
    let details = document.createElement("details")
    details.className = "compiled-file"
    details.open = true

    details.innerHTML = `<summary>${id.replace(names.namespace, "<span style = 'opacity: 0.5'>&lt;internal&gt;</span>")}</summary><div class = "content"></div>`

    details.querySelector(".content").append(...compiled.functions[id].split("\n").map(colorCommand))
    fileOutput.append(details)
  }

  if (outputOuter.offsetWidth < 400) {
    outputOuter.style.width = "400px"
  }

  consoleLog(`Code compiled successfully (${Math.round(end - start)}ms)`)
}

const consoleElem = id("console")

function consoleLog(msg, type = "log") {
  let elem = document.createElement("div")
  elem.className = "console-msg"
  elem.classList.add(type)
  elem.title = "Click to copy"

  elem.innerText = msg

  elem.onclick = () => {
    navigator.clipboard.writeText(msg)
  }

  consoleElem.append(elem)
}

function consoleProblem(msg) {
  consoleLog(msg, "problem")
}

function consoleError(name, msg) {
  consoleLog(`${name}: ${msg}`, "error")
}

function consoleWarn(msg) {
  consoleLog(msg, "warn")
}

function clearConsole() {
  consoleElem.innerHTML = ""
}

function download() {
  if (!compiled) compile()

  downloadDatapack(names.name, compiled)
}

// debugging

function _type(str) {
  if (!compiler) {
    compiler = new Compiler("", "")
    compiler.run()
  }

  let lexer = new Lexer(str), parser = new Parser(lexer)
  lexer.tokenize()
  return compiler.compileType(parser.parseType())
}
