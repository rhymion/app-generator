"""
state_machine_parser.py — Mermaid `stateDiagram-v2` subset parser.

Parses only the syntax subset the state-transition generator feature
(Issue #696, Stage 1 PR2a) needs, derived from the three real hand-written
diagrams found in inventory-app's own consumer schema:
    [*] --> {state}          initial-state declaration
    {state} --> [*]          terminal-state declaration
    {state} --> {state}      edge (no label — condition-grammar parsing is
                              a separate task, PR2b)
    %% ...                   comment line, ignored
    (blank line)              ignored

Anything outside this grammar (composite states, concurrent regions, choice
pseudostates, labeled edges) is an unrecognized construct and returns a
ParseError — fail-closed, per the design doc's "partial notation
non-support" requirement rather than silently ignoring it.

Duplicate edges are NOT rejected here — they are returned as-is in the raw
edge list. Duplicate-edge detection is a separate task's responsibility
(the validate.py extension that consumes this parser's output).
"""
from dataclasses import dataclass


@dataclass
class StateMachineDiagram:
    states: set[str]
    edges: list[tuple[str, str]]
    initial_states: set[str]
    terminal_states: set[str]


@dataclass
class ParseError:
    message: str
    line_number: int | None = None
    line_text: str = ''


_HEADER = 'statediagram-v2'


def parse_state_machine_diagram(text: str) -> StateMachineDiagram | ParseError:
    """Parse a Mermaid stateDiagram-v2 source string into a StateMachineDiagram.

    Returns a ParseError (never raises) for any construct outside the
    recognized grammar, so callers can fail-closed with a clear message.
    """
    lines = text.splitlines()

    header_line_number = None
    for i, raw_line in enumerate(lines):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith('%%'):
            continue
        if stripped.lower() != _HEADER:
            return ParseError(
                message="expected 'stateDiagram-v2' as the first non-blank, "
                        "non-comment line",
                line_number=i + 1,
                line_text=raw_line,
            )
        header_line_number = i
        break

    if header_line_number is None:
        return ParseError(message="empty diagram: no 'stateDiagram-v2' header found")

    states: set[str] = set()
    edges: list[tuple[str, str]] = []
    initial_states: set[str] = set()
    terminal_states: set[str] = set()

    for i, raw_line in enumerate(lines[header_line_number + 1:], start=header_line_number + 2):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith('%%'):
            continue

        parsed_edge = _parse_edge_line(stripped)
        if parsed_edge is None:
            return ParseError(
                message='unrecognized construct: only "[*] --> state", '
                        '"state --> [*]", and "state --> state" edges are '
                        'supported',
                line_number=i,
                line_text=raw_line,
            )

        from_token, to_token = parsed_edge

        if from_token == '[*]' and to_token == '[*]':
            return ParseError(
                message='"[*] --> [*]" is not a valid edge',
                line_number=i,
                line_text=raw_line,
            )
        if from_token == '[*]':
            states.add(to_token)
            initial_states.add(to_token)
        elif to_token == '[*]':
            states.add(from_token)
            terminal_states.add(from_token)
        else:
            states.add(from_token)
            states.add(to_token)
            edges.append((from_token, to_token))

    return StateMachineDiagram(
        states=states,
        edges=edges,
        initial_states=initial_states,
        terminal_states=terminal_states,
    )


_STATE_NAME_CHARS = set(
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'
)


def _parse_edge_line(stripped_line: str) -> tuple[str, str] | None:
    """Parse a single 'from --> to' line. Returns None if not a bare edge.

    Rejects edge-label syntax (`a --> b : label`) and anything with
    extraneous tokens — those are outside this task's grammar.
    """
    if '-->' not in stripped_line:
        return None
    parts = stripped_line.split('-->')
    if len(parts) != 2:
        return None
    from_token = parts[0].strip()
    to_token = parts[1].strip()
    if not from_token or not to_token:
        return None
    if ':' in to_token:
        # Edge-label syntax ("a --> b : label") — not this task's grammar.
        return None

    for token in (from_token, to_token):
        if token == '[*]':
            continue
        if not _is_valid_state_name(token):
            return None

    return from_token, to_token


def _is_valid_state_name(token: str) -> bool:
    return bool(token) and all(ch in _STATE_NAME_CHARS for ch in token)
