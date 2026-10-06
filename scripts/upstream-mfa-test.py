#!/usr/bin/env python3
"""A/B check: sign in with the ORIGINAL python-verisure library (reference/python-verisure).

If this works where scripts/live-test.js fails, the bug is in our Node port; if it fails the
same way, the problem is on Verisure's side. Read-only: lists installations, changes nothing.

Logs URLs and status codes only (urllib3 DEBUG) — never headers, cookies or passwords.
"""
import getpass
import json
import logging
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'reference' / 'python-verisure'))

from verisure import Session, LoginError  # noqa: E402

logging.basicConfig(level=logging.DEBUG, format='  · %(name)s: %(message)s')

email = input('Verisure e-mail: ').strip()
password = getpass.getpass('Password: ')
session = Session(email, password, str(ROOT / 'reference' / '.upstream-cookie'))

try:
    installations = session.login()
    print('Signed in without MFA.')
except LoginError as ex:
    print(f'Login said: {ex}')
    session.request_mfa()
    installations = session.validate_mfa(input('Code: ').strip())
    print('MFA accepted.')

print(json.dumps([(i['giid'], i['alias']) for i in installations['data']['account']['installations']], indent=2))
print('Cookie names stored:', sorted(session._cookies.keys()))
