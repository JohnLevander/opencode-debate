#!/usr/bin/env python3
"""Save a key through a hidden terminal prompt; never accept it as an argument."""
import getpass
import json
import os
from pathlib import Path
import sys
import tempfile
import warnings


def save_key(target: Path, key: str) -> None:
    if not key or any(c.isspace() for c in key):
        raise ValueError('Key must be nonempty and contain no whitespace.')
    if target.is_symlink():
        raise ValueError('Refusing to replace an environment file that is a symlink.')
    original = target.read_bytes() if target.exists() else None
    document = json.loads(original) if original is not None else {'version': 1}
    if not isinstance(document, dict) or document.get('version') != 1:
        raise ValueError('Existing environment file has an unsupported format; nothing was changed.')
    user = document.setdefault('user', {})
    if not isinstance(user, dict):
        raise ValueError('Existing user settings are invalid; nothing was changed.')
    variables = user.setdefault('variables', {})
    if not isinstance(variables, dict):
        raise ValueError('Existing variables are invalid; nothing was changed.')
    variables['OPENROUTER_API_KEY'] = key
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.environment-', suffix='.tmp', dir=target.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(document, stream, indent=2)
            stream.write('\n')
        if (target.read_bytes() if target.exists() else None) != original:
            raise ValueError('Environment settings changed during setup; retry with OpenChamber closed.')
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> int:
    root = Path(os.environ.get('OPENCHAMBER_DATA_DIR') or Path.home() / '.config/openchamber').expanduser()
    target = root / 'environment.json'
    print('Quit OpenChamber before continuing; reopen it after the key is saved.')
    print(f'File: {target}')
    print('Merge: user.variables.OPENROUTER_API_KEY = <the key you enter>')
    print('Existing variables/project settings are preserved. File permissions: 0600.')
    print('Entering a key approves this change; press Ctrl-C to cancel.')
    # Refuse getpass fallback rather than risk echoing a key in a noninteractive shell.
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        key = getpass.getpass('OpenRouter API key (hidden): ')
    save_key(target, key)
    print('Saved OPENROUTER_API_KEY. Reopen OpenChamber to load it.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (KeyboardInterrupt, EOFError):
        print('\nCancelled; no key was saved.', file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        # JSON/config exception strings may contain fragments of existing secrets.
        print(f'Setup failed ({type(error).__name__}); the existing environment file was not replaced.', file=sys.stderr)
        sys.exit(1)
