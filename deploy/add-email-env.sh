#!/bin/bash
# Append email/SMTP config to .env
cd /home/ubuntu/app

# Remove any existing SMTP/email lines first
sed -i '/^SMTP_/d' .env
sed -i '/^ADMIN_EMAIL/d' .env
sed -i '/^DEVELOPER_EMAIL/d' .env

# Append new values
cat >> .env << 'ENVBLOCK'
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=support@vaama.co
SMTP_PASS=ulfr omai lypg ymau
SMTP_FROM=Vaama Live <support@vaama.co>
ADMIN_EMAIL=vaamajewellery@vaama.co
DEVELOPER_EMAIL=developer@vaama.co
ENVBLOCK

echo "Done. SMTP lines in .env:"
grep -E "^SMTP_HOST|^SMTP_PORT|^SMTP_USER|^SMTP_FROM|^ADMIN_|^DEV" .env
