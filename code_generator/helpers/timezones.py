"""Curated time zone list backing the `Timezone` native enum.

Each entry is `(enum member, IANA name, standard-time UTC offset)`. The enum member is the
stored identifier and is never renamed once shipped; the IANA spelling is the only value that
may change (for example when IANA renames a zone), so it lives here and in the generated
`lib/_timezone.ts` and nowhere else. The list covers every standard-time UTC offset in current
tzdata with at least one zone. See docs/knowledge/timezone-handling.md.
"""

DEFAULT_MEMBER = 'utc'

# Prisma enum name and i18n namespace of the time zone enum.
TIMEZONE_ENUM_NAMESPACE = 'Timezone'

TIMEZONES: tuple[tuple[str, str, str], ...] = (
    ('pacific_pago_pago', 'Pacific/Pago_Pago', '-11:00'),
    ('pacific_honolulu', 'Pacific/Honolulu', '-10:00'),
    ('pacific_marquesas', 'Pacific/Marquesas', '-09:30'),
    ('america_anchorage', 'America/Anchorage', '-09:00'),
    ('america_los_angeles', 'America/Los_Angeles', '-08:00'),
    ('america_denver', 'America/Denver', '-07:00'),
    ('america_chicago', 'America/Chicago', '-06:00'),
    ('america_mexico_city', 'America/Mexico_City', '-06:00'),
    ('america_new_york', 'America/New_York', '-05:00'),
    ('america_toronto', 'America/Toronto', '-05:00'),
    ('america_bogota', 'America/Bogota', '-05:00'),
    ('america_caracas', 'America/Caracas', '-04:00'),
    ('america_st_johns', 'America/St_Johns', '-03:30'),
    ('america_sao_paulo', 'America/Sao_Paulo', '-03:00'),
    ('america_nuuk', 'America/Nuuk', '-02:00'),
    ('atlantic_azores', 'Atlantic/Azores', '-01:00'),
    ('utc', 'UTC', '+00:00'),
    ('europe_london', 'Europe/London', '+00:00'),
    ('europe_madrid', 'Europe/Madrid', '+01:00'),
    ('europe_paris', 'Europe/Paris', '+01:00'),
    ('europe_berlin', 'Europe/Berlin', '+01:00'),
    ('europe_rome', 'Europe/Rome', '+01:00'),
    ('africa_lagos', 'Africa/Lagos', '+01:00'),
    ('africa_cairo', 'Africa/Cairo', '+02:00'),
    ('africa_johannesburg', 'Africa/Johannesburg', '+02:00'),
    ('asia_jerusalem', 'Asia/Jerusalem', '+02:00'),
    ('europe_istanbul', 'Europe/Istanbul', '+03:00'),
    ('europe_moscow', 'Europe/Moscow', '+03:00'),
    ('asia_tehran', 'Asia/Tehran', '+03:30'),
    ('asia_dubai', 'Asia/Dubai', '+04:00'),
    ('asia_kabul', 'Asia/Kabul', '+04:30'),
    ('asia_karachi', 'Asia/Karachi', '+05:00'),
    ('asia_kolkata', 'Asia/Kolkata', '+05:30'),
    ('asia_kathmandu', 'Asia/Kathmandu', '+05:45'),
    ('asia_dhaka', 'Asia/Dhaka', '+06:00'),
    ('asia_yangon', 'Asia/Yangon', '+06:30'),
    ('asia_bangkok', 'Asia/Bangkok', '+07:00'),
    ('asia_jakarta', 'Asia/Jakarta', '+07:00'),
    ('asia_shanghai', 'Asia/Shanghai', '+08:00'),
    ('asia_hong_kong', 'Asia/Hong_Kong', '+08:00'),
    ('asia_singapore', 'Asia/Singapore', '+08:00'),
    ('asia_manila', 'Asia/Manila', '+08:00'),
    ('australia_perth', 'Australia/Perth', '+08:00'),
    ('australia_eucla', 'Australia/Eucla', '+08:45'),
    ('asia_seoul', 'Asia/Seoul', '+09:00'),
    ('asia_tokyo', 'Asia/Tokyo', '+09:00'),
    ('australia_adelaide', 'Australia/Adelaide', '+09:30'),
    ('australia_sydney', 'Australia/Sydney', '+10:00'),
    ('australia_lord_howe', 'Australia/Lord_Howe', '+10:30'),
    ('pacific_noumea', 'Pacific/Noumea', '+11:00'),
    ('pacific_auckland', 'Pacific/Auckland', '+12:00'),
    ('pacific_chatham', 'Pacific/Chatham', '+12:45'),
    ('pacific_apia', 'Pacific/Apia', '+13:00'),
    ('pacific_kiritimati', 'Pacific/Kiritimati', '+14:00'),
)


def timezone_members() -> list[str]:
    return [member for member, _iana, _offset in TIMEZONES]


def timezone_iana_names() -> dict[str, str]:
    return {member: iana for member, iana, _offset in TIMEZONES}
