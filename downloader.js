/*

FILE FORMAT

- <datapack name>
  - data
    - <custom namespace>
      - function
        - <custom function>.mcfunction
        - ...
    - <internal namespace>
      - function
        - <internal function>.mcfunction
        - ...
    - minecraft
      - tags
        - function
          - load.json
  - pack.mcmeta

*/

const PACK_VERSION = 101.1

const PACK_MCMETA = `
{
  "pack" : {
    "pack_format": ${PACK_VERSION},
    "description": "§7§kx§r §bCompiled from §a§o[cool language name]§r §7§kx"
  }
}
`.trimStart()

function downloadDatapack(name, compiled) {
  downloadZip(createZip(compiled), name)
}

function downloadZip(zip, name) {
  zip.generateAsync({type : "blob"}).then(blob => {
    let blobURL = URL.createObjectURL(blob)

    let a = document.createElement("a")
    a.href = blobURL
    a.download = name

    a.click()
  })
}

function createZip({ functions, tickingFunctions }) {
  let zip = new JSZip()

  let inner = zip.file("pack.mcmeta", PACK_MCMETA).folder("data")

  for (let i in functions) {
    let [namespace, name] = i.split(":")
    inner.file(`${namespace}/function/${name}.mcfunction`, functions[i])
  }

  inner.file("minecraft/tags/function/load.json", JSON.stringify({
    values: [`${names.namespace}:_load`]
  }, null, 2))
  inner.file("minecraft/tags/function/tick.json", JSON.stringify({
    values: [...tickingFunctions]
  }, null, 2))

  return zip
}
