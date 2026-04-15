## implementation

for errors, use
```
execute if function <sub_func> run return run data modify storage <call_stack> append value "compile-time generated location string" 
```
if function *succeeds*, then an error was thrown


use function tags for switch statement
- `function #zzz:switch/0`
- `#switch:0` = `{ "switch/0/0", "switch/0/1", ... }`
- `switch/0/0` = `execute unless condition return; ...`
NOTE: `return run function` is super wack, see https://minecraft.wiki/w/Commands/function

## commands

### small things

use `{}` as the path to select the outermost nbt object, for example:
```
data modify storage a {} merge ...
```

only set nbt value if the existing value is something specific
```
data modify storage a {a:1}.a set value 2
```

***

### actually useful

escape double quotes in string for macro usage

the resulting string will try to avoid escaped quotes by using either single or double quotes (whichever one is not used in the string), so you can't just strip off the quotations. this still works in a macro if you just keep the quotes on the string and use them as the quotes in the macro string.

**to test:** to escape the string and store it to storage, does it work to:

1. escape
2. trim quotes
3. escape again
4. macro

maybe??? or something similar should work i think
```
data modify storage a str.x set from <THE STRING>
(execute as text_display)
    data modify entity @s text set value {storage: a, nbt: str}
    data modify storage a str set string entity @s text 3 -1
function a:a with storage a str
```

add floats/doubles with /tp

***

### random stuff

random long but like only the big part??
```
execute store result storage a a long 4294967296 run random roll 1..
```

random int except zero
```
execute store result storage a a int 1 run random roll 1..
execute if predicate {condition: random_chance, chance: 0.5} store result storage a a int -1 run data get storage <s>
```
