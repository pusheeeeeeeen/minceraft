function colorCommand(command) {
  let wrapper = document.createElement("div")

  if (command.startsWith("#")) {
    wrapper.append(colorToken({
      type: "comment",
      value: command
    }))
  } else if (!command.length) {
    wrapper.innerText = " "
  } else {
    let remaining = command, token, lastToken = null

    while (remaining.length) {
      ({ token, remaining } = nextToken(remaining, lastToken))
      lastToken = token

      wrapper.append(colorToken(token))
    }
  }

  return wrapper
}

const colors = {
  string: "orange",
  number: "lime",
  coordinate: "lime",
  location: "cyan",
  keyword: "#faf",
  selector: "yellow",
  comment: "lightgray",
  unknown: "white"
}

function colorToken(token) {
  let span = document.createElement("span")

  span.textContent = token.value
  span.style.color = colors[token.type]
  if (token.type === "comment") {
    span.style.fontStyle = "italic"
  }

  return span
}

const tokens = {
  string: /^ *("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/,
  number: /^ *-?(\d+[bsilfd]?|\d*\.\d+[fd]?)/,
  coordinate: /^ *[~^]-?\d*(\.\d*)?/,
  location: /^ *\w+:\w+/,
  keyword: /^ *\w+/,
  selector: /^ *@[sparen]/
}

function nextToken(str, lastToken) {
  let token = { type: "unknown", value: str[0] }

  for (let i in tokens) {
    let match = str.match(tokens[i])

    if (match) {
      token = {
        type: i,
        value: match[0]
      }

      break
    }
  }

  return {
    token,
    remaining: str.slice(token.value.length)
  }
}
