# Archive Format

Expected archive contents:

- one `.xlsx` workbook
- the workbook contains a sheet named `APP 信息总表`
- the first row of that sheet starts with `AppName`

Field mapping:

- `AppName` -> `app_name`
- `GPStoreName` -> `project_name` when present, otherwise `AppName`
- `CompanyName` -> `company_name`
- `PackageName` -> `package`

Identity rule:

- `package` is the unique key
- use `package.replace(".", "_")` for the project `id`

Skip rules:

- empty package row
- layout mismatch
- missing summary sheet

