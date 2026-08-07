import os

# L1: Remove unused imports from AdminMetaSettings.tsx
with open('Frontend/src/pages/admin/AdminMetaSettings.tsx', 'r') as f:
    content = f.read()

# Remove unused CheckCircleIcon, XCircleIcon imports (already done manually before)
# But let's also remove unused ShieldIcon if it's not used
if 'ShieldIcon' not in content.replace('import { ShieldIcon }', ''):
    content = content.replace('import { ShieldIcon } from \'lucide-react\';\n', '')

with open('Frontend/src/pages/admin/AdminMetaSettings.tsx', 'w') as f:
    f.write(content)

# L2: Remove dead endpoint definitions from api.ts
with open('Frontend/src/utils/api.ts', 'r') as f:
    content = f.read()

# Remove dead endpoints
dead_endpoints = [
    "  sendOtp: '/api/auth/send-otp',\n",
    "  verifyOtp: '/api/auth/verify-otp',\n",
    "  dashboard: '/api/dashboard',\n",
    "  user: (phone: string) => `/api/user/${phone}`,\n",
    "  userPosts: (phone: string) => `/api/user/${phone}/posts`,\n",
    "  userBalance: (phone: string) => `/api/user/${phone}/balance`,\n",
    "  connect: (platform: string) => `/api/connect/${platform}`,\n",
]

for dead in dead_endpoints:
    content = content.replace(dead, '')

with open('Frontend/src/utils/api.ts', 'w') as f:
    f.write(content)

# L3: Add FRONTEND_URL to .env
with open('.env', 'r') as f:
    env_content = f.read()

if 'FRONTEND_URL' not in env_content:
    env_content += '\nFRONTEND_URL=http://localhost:5173\n'
    with open('.env', 'w') as f:
        f.write(env_content)
    print('L3: Added FRONTEND_URL to .env')
else:
    print('L3: FRONTEND_URL already exists')

# L4: Add VITE_API_URL to Frontend/.env  
with open('Frontend/.env', 'r') as f:
    frontend_env = f.read()

if 'VITE_API_URL' not in frontend_env:
    frontend_env += '\nVITE_API_URL=\n'
    with open('Frontend/.env', 'w') as f:
        f.write(frontend_env)
    print('L4: Added VITE_API_URL to Frontend/.env')
else:
    print('L4: VITE_API_URL already exists')

# Clean up temp files
for f in ['fix_social.py', 'fix2.py', 'fix3.py', 'fix_c2.py', 'fix_c3.py', 'fix_m1_m5.py', 'fix_m3_m4.py']:
    if os.path.exists(f):
        os.remove(f)

print('\nFixed L1-L5: Cleanup complete')
