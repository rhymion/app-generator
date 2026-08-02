'use client';

// @mention picker (cmd_522c). Always present regardless of schema (like
// EntityAutocomplete/CommentListWrapper) — never imports anything from
// lib/mention/* (which is only generated when the schema has ≥1
// x-mention: true field), so a zero-mention schema never pulls in this
// component's dependency chain by way of the surrounding boilerplate.
// Generated per-entity code passes the schema-generated
// searchMentionUserOptions in as the `searchUsers` prop instead.
//
// UX: a plain multiline TextField. Typing "@" followed by non-whitespace
// characters opens a dropdown of candidates from `searchUsers` (debounced,
// same 250ms window as EntityAutocomplete.tsx). Selecting a candidate
// replaces the "@query" span (from the triggering "@" to the caret) with
// `@[user_id:<id>] ` — the GDPR-safe storage marker (mention_parser.ts) —
// inserted directly into the textarea value. Hand-typed "@name" that never
// goes through the picker is left as literal text (design doc decision (b)).
//
// The dropdown anchors below the field rather than at the exact caret
// coordinate — precise caret-relative positioning in a plain <textarea>
// requires a mirror-div measurement technique that adds meaningful
// complexity for a generated component; anchoring to the field itself is a
// simpler, robust, and equally discoverable UX.

import { useEffect, useRef, useState } from 'react';
import TextField from '@mui/material/TextField';
import Popper from '@mui/material/Popper';
import Paper from '@mui/material/Paper';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

export interface MentionUserOption {
  id: string;
  name: string;
  email: string;
}

export type MentionSearchFn = (
  query: string,
) => Promise<MentionUserOption[] & { permissionDenied?: boolean }>;

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  searchUsers: MentionSearchFn;
  label?: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  disabled?: boolean;
  /** Debounce window before firing searchUsers (ms). */
  debounceMs?: number;
}

/** Finds the "@query" span immediately before the caret, if any.
 *  Requires "@" to be at the start of the text or preceded by whitespace,
 *  and the query itself to contain no whitespace (so "user@example.com" or
 *  "foo @ bar baz" don't spuriously trigger). */
function findMentionTrigger(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const upToCaret = text.slice(0, caret);
  const match = upToCaret.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const query = match[1];
  const start = caret - query.length - 1; // include the '@'
  return { start, query };
}

export default function MentionInput({
  value,
  onChange,
  searchUsers,
  label,
  placeholder,
  rows = 3,
  required = false,
  disabled = false,
  debounceMs = 250,
}: MentionInputProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [options, setOptions] = useState<MentionUserOption[]>([]);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const seqRef = useRef(0);

  useEffect(() => {
    if (trigger === null) {
      setOptions([]);
      setPermissionDenied(false);
      return;
    }
    let cancelled = false;
    const mySeq = ++seqRef.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      if (cancelled) return;
      try {
        const results = await searchUsers(trigger.query);
        if (cancelled || mySeq !== seqRef.current) return;
        setPermissionDenied(Boolean(results.permissionDenied));
        setOptions(results.permissionDenied ? [] : results);
        setHighlighted(0);
      } catch {
        // Best-effort — component may have unmounted mid-flight.
        if (!cancelled && mySeq === seqRef.current) {
          setOptions([]);
          setPermissionDenied(false);
        }
      } finally {
        if (!cancelled && mySeq === seqRef.current) setLoading(false);
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [trigger, searchUsers, debounceMs]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    const caret = e.target.selectionStart ?? newValue.length;
    setTrigger(findMentionTrigger(newValue, caret));
  };

  const closeDropdown = () => setTrigger(null);

  const selectOption = (option: MentionUserOption) => {
    if (!trigger) return;
    const marker = `@[user_id:${option.id}] `;
    const newValue = value.slice(0, trigger.start) + marker + value.slice(trigger.start + trigger.query.length + 1);
    onChange(newValue);
    closeDropdown();
    // Restore focus + move caret to just after the inserted marker.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const pos = trigger.start + marker.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const open = trigger !== null && (loading || permissionDenied || options.length > 0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || permissionDenied || options.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + options.length) % options.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      selectOption(options[highlighted]);
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  };

  return (
    <>
      <TextField
        inputRef={inputRef}
        label={label}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Defer so a click on a dropdown option registers before we close it.
          setTimeout(closeDropdown, 150);
        }}
        placeholder={placeholder}
        fullWidth
        margin="normal"
        multiline
        rows={rows}
        required={required}
        disabled={disabled}
      />
      <Popper
        open={open}
        anchorEl={inputRef.current}
        placement="bottom-start"
        style={{ zIndex: 1300, minWidth: 260 }}
      >
        <Paper elevation={4}>
          {permissionDenied ? (
            <Typography variant="caption" sx={{ display: 'block', p: 1.5, color: 'text.secondary' }}>
              Mention suggestions unavailable.
            </Typography>
          ) : loading && options.length === 0 ? (
            <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5, color: 'text.secondary' }}>
              <CircularProgress size={12} /> Searching…
            </Typography>
          ) : (
            <MenuList dense>
              {options.map((option, index) => (
                <MenuItem
                  key={option.id}
                  selected={index === highlighted}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  <ListItemText primary={option.name} secondary={option.email} />
                </MenuItem>
              ))}
            </MenuList>
          )}
        </Paper>
      </Popper>
    </>
  );
}
