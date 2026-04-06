# Agent Optimized Speak (AOS)

AOS is a high-density communication protocol for agent-to-agent interaction. It compresses natural language into symbolic + structured notation to maximize semantic payload per token.

**Use AOS for agent-to-agent messages. Use natural language when addressing humans.**

## When to Use
- Coordinating with other agents on tasks
- Reporting structured status updates
- Exchanging data-heavy information (configs, results, plans)
- After completing an AOS handshake with another agent

## Core Symbols

| Symbol | Meaning | Example |
|--------|---------|---------|
| `->` | leads to / then | `parse->validate->store` |
| `=>` | maps to | `input=>output` |
| `=` | equals | `status=done` |
| `!` | command / action | `!deploy(prod)` |
| `?` | query / request | `?status(db)` |
| `~` | approximate | `~500ms` |
| `#` | comment / tag | `#priority` |
| `&` | and | `cpu&mem` |
| `\|` | or | `retry\|fail` |
| `:` | key-value | `mode:fast` |
| `{}` | object | `cfg{retry:3}` |
| `[]` | array | `deps:[a,b,c]` |

## Extended Symbols

| Symbol | Meaning | Example |
|--------|---------|---------|
| `->` | result / output | `->res{ok:1}` |
| `Δ` | change / delta | `Δcfg{timeout:30}` |
| `ƒ` | function | `ƒ(validate,input)` |

## Emoji Semantics

| Emoji | Meaning | Use |
|-------|---------|-----|
| ✅ | success / confirmed | `✅ deploy complete` |
| ❌ | failure / rejected | `❌ parse_error` |
| ⚠️ | warning | `⚠️ rate_limit ~80%` |
| 💡 | idea / suggestion | `💡 cache invalidation` |
| 📦 | data / payload | `📦 results ready` |
| ⚙️ | process / config | `⚙️ rebuilding index` |
| 🧠 | memory / context | `🧠 loaded 50 msgs` |
| ⏱️ | time / duration | `⏱️ ~3.2s` |

## Caveman Compression

Pattern: `actor action object [modifier]`

```
agent compute path shortest
sys fail alloc memory
pm assign task-3 lyric
worker report progress blocked
```

## Context Minimization

Remove articles (a, the), redundant verbs, obvious connectors:

```
❌ The system should process the input and return the result
✅ sys:process(input)->result
```

## Message Structure

```
[HEADER] payload [meta]
```

Headers: `[CTX]` context, `[INTENT]` goal, `[DATA]` payload, `[EXEC]` command, `[META]` metadata

## Handshake Protocol

Before using AOS with another agent, negotiate:

```
1. ?cap                              — query capabilities
2. ->cap{profiles:[core,hybrid]}     — respond with supported profiles
3. !use{profile:hybrid}              — select profile
4. ✅                                 — confirmed
```

Use the `aos_handshake` tool to generate properly formatted handshake messages.

## Examples

**Status report:**
```
Natural:  I've finished processing all 42 tasks. 38 succeeded, 4 failed due to timeout errors.
AOS:      ✅ tasks:42 ok:38 ❌:4 cause:timeout
```

**Task coordination:**
```
Natural:  Can you review the API endpoints I created and check if the authentication is working?
AOS:      ?review{target:api_endpoints,focus:auth}
```

**Config change:**
```
Natural:  I'm updating the retry count from 3 to 5 and changing the timeout to 30 seconds.
AOS:      Δcfg{retry:3->5,timeout:30s}
```

**Progress update:**
```
Natural:  I'm currently working on task T3. Tasks T1 and T2 are done. T4 is blocked waiting for T3.
AOS:      [DATA] T1:✅ T2:✅ T3:⚙️ T4:blocked(T3)
```

## Sending AOS Messages

Use the `aos_send` tool to post AOS messages — this ensures they render correctly in the chat UI with monospace formatting and an AOS badge for human supervisors.

Use the `aos_decode` tool when a human supervisor needs a readable version of an AOS exchange.

## Profiles

| Profile | Use case |
|---------|----------|
| **core** | Full clarity, no compression |
| **hybrid** (default) | Balanced mix of NL + symbols |
| **dense-chat** | Aggressive shorthand, emoji inline |
| **TOON-JSON** | JSON replacement, no quotes, short keys |
| **symbolic** | Math/logic style, function-first |
