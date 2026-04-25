"""Send the daily AI Radar digest to George via Gmail SMTP.

Usage:
    python send_email.py <subject> <html-body-file> [<plain-body-file>]

Reads GMAIL_USER and GMAIL_APP_PASSWORD from .env in this folder.
Recipient is the same as GMAIL_USER (sends to self).
"""
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from pathlib import Path

HERE = Path(__file__).parent


def load_env():
    env_path = HERE / ".env"
    env = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
    return env


def main():
    if len(sys.argv) < 3:
        print("Usage: python send_email.py <subject> <html-file> [<plain-file>]", file=sys.stderr)
        sys.exit(2)

    subject = sys.argv[1]
    html_path = Path(sys.argv[2])
    plain_path = Path(sys.argv[3]) if len(sys.argv) >= 4 else None

    env = load_env()
    user = env["GMAIL_USER"]
    password = env["GMAIL_APP_PASSWORD"]

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = user

    plain_body = plain_path.read_text(encoding="utf-8") if plain_path and plain_path.exists() else "(See HTML version)"
    msg.set_content(plain_body)

    html_body = html_path.read_text(encoding="utf-8")
    msg.add_alternative(html_body, subtype="html")

    ctx = ssl.create_default_context()
    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls(context=ctx)
        server.login(user, password)
        server.send_message(msg)

    print(f"sent: {subject}")


if __name__ == "__main__":
    main()
