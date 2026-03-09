"""Naming convention utilities — port of helpers/naming.ts"""
import re

RESERVED_WORDS = {
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
    'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function',
    'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null',
    'package', 'private', 'protected', 'public', 'return', 'super', 'switch', 'static',
    'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
    'await',
}


def to_camel_case(s: str) -> str:
    """user_name -> userName"""
    return re.sub(r'_([a-z])', lambda m: m.group(1).upper(), s)


def to_pascal_case(s: str) -> str:
    """user_name -> UserName"""
    camel = to_camel_case(s)
    return camel[0].upper() + camel[1:] if camel else camel


def to_pascal_case_from_var(s: str) -> str:
    """camelCase -> PascalCase (capitalise first letter only, no underscore splitting)"""
    return s[0].upper() + s[1:] if s else s


def to_title_case(s: str) -> str:
    """user_name -> User Name"""
    return ' '.join(word[0].upper() + word[1:] for word in s.split('_'))


def safe_var_name(name: str) -> str:
    """delete -> deleteValue, user_name -> userName"""
    camel = to_camel_case(name)
    return f'{camel}Value' if camel in RESERVED_WORDS else camel


def singularize(name: str) -> str:
    """shift_assignments -> shift_assignment (preserves case style)"""
    if not name:
        return name
    is_pascal = name[0] == name[0].upper()
    if not name.lower().endswith('s'):
        return name
    base = name[:-1]
    if is_pascal:
        return base[0].upper() + base[1:] if base else base
    return base
