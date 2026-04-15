function id(id) { return document.getElementById(id) }
function query(q) { return document.querySelector(q) }

const input = id("input")

// FILES

const fileControls = id("file-controls"), fileSelect = id("file-select"), newFileNameInput = id("new-file-name")

let files, currentFile

function setCurrentFile(name = null) {
  name ??= files.keys().next().value

  currentFile = name
  localStorage.setItem("current-file", name)

  fileSelect.value = name
  input.value = files.get(name)
  input.focus()
}

function saveFiles() {
  localStorage.setItem("files", JSON.stringify([...files.entries()]))
}

function updateFileSelect() {
  fileSelect.innerHTML = ""

  for (let name of files.keys()) {
    let option = document.createElement("option")
    option.innerText = name
    fileSelect.append(option)
  }
}

try {
  currentFile = localStorage.getItem("current-file")
  files = new Map(JSON.parse(localStorage.getItem("files")))
} catch {
  files = new Map()
}
if (!files.size) files.set("file 1", "")
updateFileSelect()
setCurrentFile(files.has(currentFile) ? currentFile : null)

fileSelect.oninput = e => {
  setCurrentFile(e.target.value)
}

id("file-add").onclick = () => {
  fileControls.classList.add("show-name")
  newFileNameInput.focus()
}

id("file-remove").onclick = () => {
  if (confirm(`Are you sure you want to delete file '${currentFile}'?`)) {
    files.delete(currentFile)
    if (!files.size) files.set("file 1", "")
    updateFileSelect()
    saveFiles()
    setCurrentFile()
  }
}

newFileNameInput.onkeydown = e => {
  if (e.code === "Enter") {
    let name = e.target.value.trim().replace(/\s+/g, " ")
    if (!name) return

    e.target.value = ""
    if (!files.has(name)) {
      files.set(name, "")
      updateFileSelect()
      saveFiles()
    }
    setCurrentFile(name)
  } else if (e.code !== "Escape") return // <-- bad code warning

  e.preventDefault()
  fileControls.classList.remove("show-name")
}

// RESIZING

const resizePageCover = id("resize-cover")
const outputOuter = id("output"), outputResizer = query("#right .resize")
const consoleOuter = id("console"), consoleResizer = query("#bottom .resize")

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

// EDITOR

const functionOutput = id("functions")

let saveDebounce

input.oninput = () => {
  clearTimeout(saveDebounce)
  saveDebounce = setTimeout(() => {
    files.set(currentFile, input.value)
    saveFiles()
  }, 300)

  compiled = null
}

let projectName = "TEST"

id("compile").onclick = compile
id("download").onclick = download

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
      consoleProblem(`${e.line}:${e.column || "?"} ${e}\n\n${e.stack.replace(/https?:\/\/\S+\//g, "")}`)
    }

    return
  }

  let end = performance.now()

  functionOutput.innerHTML = ""

  for (let id in compiled.functions) {
    let details = document.createElement("details")
    details.className = "compiled-file"
    details.open = true

    details.innerHTML = `<summary>${id.replace(names.namespace, "<span style = 'opacity: 0.5'>&lt;internal&gt;</span>")}</summary><div class = "content"></div>`

    details.querySelector(".content").append(...compiled.functions[id].split("\n").map(colorCommand))
    functionOutput.append(details)
  }

  if (outputOuter.offsetWidth < 400) {
    outputOuter.style.width = "400px"
  }

  consoleLog(`Code compiled successfully (${Math.round(end - start)}ms)`)
}

// CONSOLE

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

// DEBUG

function _type(str) {
  if (!compiler) {
    compiler = new Compiler("", "")
    compiler.run()
  }

  let lexer = new Lexer(str), parser = new Parser(lexer)
  lexer.tokenize()
  return compiler.compileType(parser.parseType())
}
