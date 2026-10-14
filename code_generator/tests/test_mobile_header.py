"""
Header and footer of the generated Expo app (templates/mobile/components/).

Runs the real build_user_schema.py -> generate.py pipeline on tests/fixtures/mobile_entity_gate and checks that the
header stays clear of the system UI and that its actions are large enough to hit (Issue #1014):

- the header reads the top safe-area inset, so it is not drawn under the status bar, notch or camera cutout
- the footer reads the bottom safe-area inset, so it is not drawn under the home indicator
- every header action has a minimum touch target of 44x44 points

Run:
    cd code_generator && python3 -m pytest tests/test_mobile_header.py -v
"""
from pathlib import Path
import re
import shutil

import pytest

from build_user_schema import build_user_schema
from generate import generate

FIXTURE = Path(__file__).resolve().parent / 'fixtures' / 'mobile_entity_gate'


@pytest.fixture(scope='module')
def components(tmp_path_factory):
    tmp_path = tmp_path_factory.mktemp('mobile_header')
    (tmp_path / 'prisma').mkdir(parents=True)
    shutil.copy(FIXTURE / 'schema.prisma', tmp_path / 'prisma' / 'schema.prisma')
    intermediate = tmp_path / 'generated_json_schema.yaml'
    build_user_schema(FIXTURE / 'json_schema.yaml', FIXTURE / 'schema.prisma', intermediate)
    generate(str(intermediate), str(tmp_path))
    return tmp_path / 'mobile' / 'components'


def test_header_keeps_clear_of_the_top_safe_area(components):
    source = (components / 'Header.tsx').read_text()
    assert "from 'react-native-safe-area-context'" in source
    assert 'useSafeAreaInsets()' in source
    assert re.search(r'paddingTop:\s*insets\.top\s*\+', source)


def test_header_actions_have_a_44_point_touch_target(components):
    source = (components / 'Header.tsx').read_text()
    assert 'const MIN_TOUCH_TARGET = 44;' in source
    action = re.search(r'action:\s*\{([^}]*)\}', source).group(1)
    assert 'minWidth: MIN_TOUCH_TARGET' in action
    assert 'minHeight: MIN_TOUCH_TARGET' in action


def test_footer_keeps_clear_of_the_bottom_safe_area(components):
    source = (components / 'FooterBar.tsx').read_text()
    assert 'useSafeAreaInsets()' in source
    assert 'paddingBottom: insets.bottom' in source
