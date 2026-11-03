## Overview

_[Click here](https://pusheeeeeeeen.github.io/minceraft/editor/) to try it yourself._

This is a **compiler from a custom programming language to Minecraft commands**. The programming language is statically-typed and uses a syntax similar to TypeScript. The output is a [Minecraft datapack](https://minecraft.wiki/w/Data_pack), which contains multiple .mcfunction files containing Minecraft commands.

## Structure

### Parser

The parser first splits the file into tokens like numbers or keywords, and filters out whitespace and comments (see [lexer.js](compiler/lexer.js)). Next, the parser generates an AST from the tokens using _recursive descent parsing_ (see [parser.js](compiler/parser.js)).

Expressions are parsed by first gathering all operators and “leaf expressions” (expressions without any operators) into a list. Then, that list is iteratively merged into a tree by finding operators that have a higher precedence than the ones on either side, and replacing that segment of the list with a single node. For example: `A + B * C` → `A + (B*C)` → `(A+(B+C))`. The same process handles unary operators: `- A . B + C` → `- (A.B) + C` → `(-(A.B)) + C` → `((-(A.B))+C)`. Function calls (`f(...)`) and indexing (`a[...]`) are considered postfix operators with extra data for the arguments or index.

### Type checking

Every variable and parameter is annotated with a type,* and every expression has its type calculated depending on its contents. If the type required by a variable or parameter doesn’t match the type of the supplied expression, then a type error is thrown.

Every _kind_ of type (a class, `null`, unions - `A | B`, etc.) knows how to check if it is a subtype of/assignable to some other type, which is the only operation that is needed to do all the necessary type checks.

<small>_*Variable types can also be inferred from the value they are initialized to._</small>

### Code generation

Every expression or statement in the input program turns into one or more Minecraft commands. Each function or code block in the program will generate its own Minecraft function file in the outputted datapack.* Datapack functions are also generated for a variety of other reasons, most commonly to make use of [function macros](https://minecraft.wiki/w/Function_(Java_Edition)#Macros), a feature added to Minecraft in late 2023, which makes this whole thing possible (or at least a _lot_ easier).

Many of the generated commands are the [`/data` command](https://minecraft.wiki/w/Commands/data), which is used to read and write to [command storage](https://minecraft.wiki/w/Command_storage_format), which is a storage for [NBT data](https://minecraft.wiki/w/NBT_format), a format similar to JSON containing strings, numbers, lists, etc. This is the main mechanism by which almost all values are stored at runtime, including a stack for local variables, a “heap” for object instances,** and other formats for global data like class methods. 

The compiler includes a few basic optimizations. Constant variables can have their values inlined, which can, for example, skip compiling a branch of an `if` statement that never runs. 

<small>_*Blocks that compile to a single command are sometimes inlined._</small>

<small>_**Due to the limitations of the NBT format, the “heap” is stored as a compound tag (hash table), where pointers are the keys._</small>

## Language design

### OOP

The language supports OOP with features like classes, inheritance, and overriding, but unlike Java, you aren’t forced to use them. Functions (including class members) are considered “first-class citizens,” meaning that they can be assigned to variables and passed as parameters, just like any other object.

Classes support _dynamic dispatch_. A global lookup table of class methods is initialized at the start of the program, and when a class method is called, the runtime type of the object it was called on is used to look up the method in the table. The lookup results in a function object which can then be called using the same mechanism that handles calling unknown functions in variables. All class methods have an implicit first argument for the `this` value.

### Types

The compiler has support for _generic classes_. See [this example](programs/holder.txt) for a basic use case for generics. Generics can be used in combination with inheritance, for example (building off of the example linked above) `class StringHolder extends Holder<string>` or `class NumberHolder<T extends number> extends Holder<T>`.

_Algebraic types_ are also supported, for example “string or int” - `string | int`, or “class A and class B” - `A & B`. Usage for these types, especially intersection types (`&`) is currently limited. They will become more useful as more advanced features are added, like interfaces.

## Examples

See [the programs folder](programs) for all examples. One example of note is [bounce.txt](programs/bounce.txt), which places a hollow glass cube into the world and animates a block “bouncing” inside it, similar to the DVD logo animation, but in 3D.
