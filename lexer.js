class Lexer {
  constructor(code) {
    this.remaining = code

    // for (let i of [this.STRING, this.NUMBER, this.IDENTIFIER, this.PUNCTUATION, this.OPERATOR, this.COMPILER_DIRECTIVE].flat()) {
    //   if (!i.toString().startsWith("/^")) {
    //     throw new Error("Lexer regexes must start with '^'")
    //   }
    // }
  }

  KEYWORDS = new Set([
    "print",
    "let", "const",
    "if", "else",
    "for", "while", "break", "continue",
    "function", "return",
    "true", "false", "null",
    "class", "extends", "super", "new", "static", "shared",
    "type", // "in", "out",
  ])

  IGNORE = /^([\s\t\n]|(\/\/.*(\n|$)))+/

  STRING = [/^"([^"\n\\]|\\.)*"/, /^'([^'\n\\]|\\.)*'/, /^`([^`\\]|\\.)*`/]
  NUMBER = [/^0x[\da-f]+[bsilfd]?/i, /^0o[0-7]+[bsilfd]?/i, /^0b[01]+[bsilfd]?/i, /^\d+\.(?![a-z_$])\d*[fd]?/i, /^\d*\.\d+[fd]?/i, /^\d+[bsilfd]?/i]
  IDENTIFIER = [/^[a-z_$][a-z_$\d]*/i]
  PUNCTUATION = [/^[()\[\]{},;]/, /^(\.\.\.|=>)/] // "..." and "=>" are not operators b/c they don't have order of operations
  OPERATOR = [/^([+\-/%^=!]|[&|*<>]{1,2})=?/, /^\.(\.=?)?/, /^\?(\?=?)?/, /^(\+\+|--|:)/]
  COMPILER_DIRECTIVE = [/^#[a-z_$.\d]*/i]

  tokens = []
  pos = -1

  get eof() {
    return this.pos >= this.tokens.length - 1
  }

  next() {
    return this.tokens[++this.pos] ?? null
  }
  peek() {
    return this.tokens[this.pos + 1] ?? null
  }
  current() {
    return this.tokens[this.pos] ?? null
  }
  previous() {
    return this.tokens[--this.pos] ?? null
  }
  insertToken(type, value, afterNewLine = false) {
    if (this.pos === -1) throw new Error("Cannot insert token at start")
    this.tokens[this.pos--] = { type, value, afterNewLine }
  }

  tokenize() {
    let afterNewLine = true

    this.match(this.IGNORE)

    while (this.remaining.length) {
      let token = this.getNext()
      token.afterNewLine = afterNewLine

      this.tokens.push(token)

      afterNewLine = !!this.match(this.IGNORE)?.includes("\n")
    }
  }

  STRING_ESCAPES = {
    // TODO add more string escapes
    s: " ",
    t: "\t",
    n: "\n",
    r: "\r"
  }

  getNext() {
    let match

    if ((match = this.match(this.STRING))) {
      return {
        type: "string",
        value: match.slice(1, -1).replaceAll(/\\(.?)/g, (_, letter) => {
          if (!letter) throw new error.SyntaxError("Unexpected line break after backslash in string")
          return this.STRING_ESCAPES[letter] ?? letter
        })
      }
    } else if ("\"'`".includes(this.remaining[0])) {
      throw new error.SyntaxError("Unterminated string")
    } else if ((match = this.match(this.NUMBER))) {
      return {
        type: "number",
        value: match.toLowerCase()
      }
    } else if ((match = this.match(this.IDENTIFIER))) {
      return {
        type: this.KEYWORDS.has(match) ? "keyword" : "identifier",
        value: match
      }
    } else if ((match = this.match(this.PUNCTUATION))) {
      return {
        type: "punctuation",
        value: match
      }
    } else if ((match = this.match(this.OPERATOR))) {
      return {
        type: "operator",
        value: match
      }
    } else if ((match = this.match(this.COMPILER_DIRECTIVE))) {
      return {
        type: "comp-dir",
        value: match.slice(1)
      }
    } else throw this.unexpectedChar()
  }

  test(regexes) {
    return regexes instanceof RegExp
      ? this.testRegex(regexes)
      : regexes.some(regex => this.testRegex(regex))
  }

  match(regexes) {
    if (regexes instanceof RegExp) {
      return this.matchRegex(regexes)
    } else {
      for (let regex of regexes) {
        let match = this.matchRegex(regex)
        if (match) return match
      }
    }
  }

  testRegex(regex) {
    return regex.test(this.remaining)
  }

  matchRegex(regex) {
    let match = this.remaining.match(regex)
    if (!match) return null

    this.remaining = this.remaining.slice(match[0].length)
    return match[0]
  }

  unexpectedChar() {
    let msg = this.remaining
      ? `Unexpected character '${this.remaining[0]}'`
      : "Unexpected end of file"

    return new error.SyntaxError(msg)
  }
}
