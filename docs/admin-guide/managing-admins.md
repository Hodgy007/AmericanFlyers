# Managing admins

This page explains how admin access is decided, why a banned admin loses access, and how to add or remove an admin with SQL.

## How admin access works

Admin status comes from two things in the database:

1. **The `public.admins` table**, which lists admin email addresses. The schema file seeds the first admin row.
2. **The function `public.is_admin()`**, which returns true when the signed-in account:
   - has an email that matches a row in `public.admins` (compared without regard to upper or lower case),
   - has a verified email address (`emailVerified` in Neon Auth's `user` table), and
   - isn't banned.

The browser asks `is_admin()` whether to show the **🛠 Admin** button. Every admin function (overview, rider list, ban, and feedback inbox) checks `is_admin()` again on the server, and raises *Admins only* for anyone else. Hiding the button isn't the protection; the database check is.

Because the table has no grants and no policies for the app's roles, the app can't read or edit `public.admins` directly. Only the security-definer functions do.

## Add an admin

1. The person must have signed in at least once, so that their account exists in Neon Auth.
2. Their email must be verified in Neon Auth.
3. Open the **SQL Editor** in the Neon Console for the `americanflyers` project, and run:

```sql
insert into public.admins (email) values ('you@example.com');
```

Use the exact email on their account. The match ignores upper and lower case, so the case doesn't matter.

Sign out and back in, or reload the page, and the **🛠 Admin** button appears.

## Remove an admin

```sql
delete from public.admins where lower(email) = lower('you@example.com');
```

The person loses admin access on their next check. Their account is kept, and they keep their own rides.

## Ban an admin

A banned admin loses access, because `is_admin()` returns false for banned accounts. The dashboard doesn't offer **Ban** on admin rows, so banning an admin normally means using SQL. See [Admin dashboard](admin-dashboard.md#ban-and-unban) for the database behavior.

## Run the SQL safely

- Run admin changes in the Neon SQL Editor, which connects as the project owner. The app's own connection can't change the admins table.
- Keep the list short. Each admin can see every rider's totals, names and emails, and can ban riders and reply to feedback.
- The `db/schema.sql` file records the schema and the first admin. Changing the list later is a data change, so it isn't recorded there unless you update the file yourself. See [Contributing](../developer-guide/contributing.md).
