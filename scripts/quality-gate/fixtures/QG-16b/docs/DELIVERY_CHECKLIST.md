# Fixture checklist

### 4.2 Part 1

| Screen | Element | Action | Target (route / RPC / navigation) | Success state | Test ID | PASS/FAIL |
|---|---|---|---|---|---|---|
| M-X-01 | Settings | tap | `/settings` | settings | t | ☐ |
| M-X-01 | Register | auto | `POST /devices/register` then `router.back()` | done | t | ☐ |
| M-X-02 | Link | auto | `/r/{code}` and `/devices/register` | done | t | ☐ |

### 4.6 Part 5

| Screen | Element | Action | Target | Success state | Test ID | PASS/FAIL |
|---|---|---|---|---|---|---|
| W-X-01 | Web only | link | `/pricing` | page | t | ☐ |
