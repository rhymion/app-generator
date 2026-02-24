# Goal

* To create app generation tool with which user can create web applications with database by defining data structure and minimal UI composition

# Requirements

* Code generation script generates code with which user can do CRUD operations, given Prisma schema, configuration file (yaml) and common components / modules
* Code generation script can handle common data structure, such as one to one, one to many, many to many relations and corresponding self relations
* Components to handle those relations are provided, such as list and table, both ordered or not
* Data type such as string, number, boolean and enum are supported
* REST API corresponding to UI is also provided with the same access right
* Performance is good enough for limited users
* Performance degradation is minimized for heavy loads by database architecture, scaling out and so on
* Administrators can define permission for various kind of users so that each user has necessary privilege to do their tasks but security risk is minimized
* Vulnerability of libraries are managed so that the packages are not the source of security risks
* Code does not use logic to allow low level access to bypass constraints
