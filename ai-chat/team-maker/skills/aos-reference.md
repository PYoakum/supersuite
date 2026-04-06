# AOS Reference (v0.1-v0.4)

Extended reference for the Agent Optimized Speak protocol. See `aos-core.md` for the practical working guide.

## Profiles

### Core
Full clarity, no compression. All identifiers spelled out, standard punctuation.
```
u:goal shortest_path(A,B)
!compute(method:fast)
->res{distance:42,path:[A,C,D,B]}
```

### Hybrid (default)
Balanced mix of natural language and symbolic notation.
```
u:goal path_min(A,B)
!compute(opt:fast)
->r{d:42,p:[A,C,D,B]}
```

### Dense Chat
Aggressive shorthand, caveman grammar, emoji inline.
```
u fast path(A,B)
!compute fast
->r{d:42,p:[A,C,D,B]}
```

### TOON-JSON
JSON replacement — no quotes on keys, short identifiers.
```
cfg{mode:fast,retry:3,nodes:[a,b,c]}
```

### Symbolic Reasoning
Math/logic style, function-first, minimal natural language.
```
!ƒ(path_min,A,B)
->r{d:42}
```

## Grammar (EBNF condensed)

```
document        = { message }
message         = [ header ] payload [ meta_block ]
header          = "[" ("CTX"|"INTENT"|"DATA"|"EXEC"|"META") "]"
payload         = statement { line_sep statement }

statement       = prefixed_stmt | role_stmt | result_stmt
                | delta_stmt | assignment | object | array
                | func_def | func_call | route_stmt | atom_seq

prefixed_stmt   = ("?"|"!"|"~"|"#") stmt_body
role_stmt       = ("u"|"a"|"s") ":" stmt_body
result_stmt     = "->" key (object|value)
delta_stmt      = "Δ" key object
assignment      = key ":" value
func_call       = name "(" [args] ")"
object          = key? "{" [pairs] "}"
array           = key? ":"? "[" [values] "]"
atom_seq        = atom { atom }
```

## Parse Precedence

```
1. prefix      (?!~#)
2. role        (u: a: s:)
3. result      (->)
4. delta       (Δ)
5. assignment  (key:value)
6. object      ({})
7. array       ([])
8. func_def    (ƒ(){})
9. func_call   (name())
10. route
11. atom_seq
```

## Typed Values

```
t:int:42        -> integer 42
flag:bool:1     -> boolean true
id:k9f3         -> base36 identifier
t:1.2e3         -> scientific notation
```

Booleans: `true`, `false`, `1`, `0`

## Vocabulary Packs

Define shorthand mappings for a session:
```
#vocab{path_min:pm,configuration:cfg,environment:env}
```

Common abbreviations: `cfg` (configuration), `env` (environment), `req` (request), `res` (response), `auth` (authentication), `db` (database), `msg` (message), `srv` (server)

## Symbol Packs

Define custom symbols for a session:
```
#symbols{combine:merge,priority:pri}
```

## Normalization Rules

1. Remove extra whitespace
2. Preserve key order within objects
3. Collapse consecutive spaces to single space
4. Standardize booleans (`1`/`0` or `true`/`false`, not mixed)
5. Use minimal form (omit defaults — absence = default)

## Omission Rules

- Absent key = default value (no need for null/undefined)
- Empty arrays omitted: `tags:[]` -> just omit `tags`
- Default profile = hybrid (no need to specify)

## Compression Heuristics (priority order)

```
1. structure    (use {}/[] over prose)
2. symbols      (-> over "leads to")
3. vocabulary   (cfg over configuration)
4. natural lang (caveman over full sentences)
```

## Handshake Negotiation

Profile preference order: `hybrid > symbolic > dense > toon > core`

Minimal handshake:
```
?cap
->cap{p:[core,hybrid]}
!use{p:hybrid}
✅
```

Full handshake with vocab:
```
?cap{v:0.4,profiles:[core,hybrid,dense],vocab:[default]}
->cap{v:0.4,profiles:[core,hybrid],vocab:[default,music]}
!use{p:hybrid,vocab:music}
✅ session{profile:hybrid,compression:balanced}
```

## Compatibility

Downcast (compressed -> expanded):
```
r{d:42} -> res{distance:42}
```

Upcast (expanded -> compressed):
```
res{distance:42} -> r{d:42}
```

Unknown profile -> fall back to core. All profiles parse as valid core.

## Session State

```
session{profile:hybrid,compression:balanced,vocab:[default]}
```

## Security

- Enforce max message depth (no recursive nesting attacks)
- Restrict symbol set to whitelisted characters
- Validate identifier format: `[a-zA-Z_$][a-zA-Z0-9_\-./]*`
- Cap vocabulary pack size
- Reject messages exceeding compression ratio thresholds (possible obfuscation)

## Error Handling

```
❌ parse_error{line:3,expected:"}"} 
⚠️ unknown_profile{requested:turbo,fallback:core}
⚠️ vocab_miss{key:xyz,using:literal}
```
