# Vaama Live — Database Access Instructions

The application uses **SQLite** in WAL (Write-Ahead Logging) mode for high-performance persistence.

## 📁 Database Location
The database file is located at:
`~/app/data/livecall.db` (on the AWS server)

## 🛠 Required Tools
To access the database like a "pg browser" (PostgreSQL browser), we recommend using:
1. **DB Browser for SQLite** (Recommended, Free, Open Source) — [Download Here](https://sqlitebrowser.org/)
2. **DBeaver** (Advanced management tool) — [Download Here](https://dbeaver.io/)

## 🔗 How to Connect Locally
Since the database is a local file on the server, you have two ways to view it:

### Option A: Download the database to your PC
1. Run this command in your computer's PowerShell:
   ```bash
   scp -i "C:\Users\HP\Downloads\vaama-key.pem" ubuntu@65.1.246.232:/home/ubuntu/app/data/livecall.db .\livecall_backup.db
   ```
2. Open `livecall_backup.db` in **DB Browser for SQLite**.

### Option B: Connect via SSH Tunnel (DBeaver)
1. Open DBeaver.
2. Create a new **SQLite** connection.
3. In the "Path" field, put `/home/ubuntu/app/data/livecall.db`.
4. Go to the **SSH** tab.
5. Enter:
   - Host: `65.1.246.232`
   - User: `ubuntu`
   - Auth Method: `Public Key`
   - Key Path: `C:\Users\HP\Downloads\vaama-key.pem`
6. Click **Test Connection**.

## 📊 Key Tables
- `call_history`: Contains all completed and ongoing calls.
  - `user_name`, `user_phone`: Customer details.
  - `looking_for`, `price_range`: Interests captured on landing page.
  - `admin_username`: Which agent picked up the call.
  - `admin_ip`: The IP address of the agent.
  - `started_at`, `ended_at`, `duration_secs`: Timing details.
- `scheduled_calls`: All appointments booked by customers.
- `admin_audit_log`: Record of all admin actions (logging in, accepting calls, force-ending).
