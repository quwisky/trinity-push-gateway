# Automated Node Docker Major Upgrades

Automated pull requests that update the Docker build-stage Node image across a major version are out of scope.

## Why this is out of scope

The Node image is used only to install build dependencies before Bun builds the self-hosted gateway. Its version is coordinated with the repository's Node engine, `.nvmrc`, package-manager provisioning, contributor documentation, and container validation. A Docker-only major bump can therefore break the build without providing a runtime benefit.

Node major upgrades remain possible as deliberate maintenance work. Such an upgrade must update every version surface together, choose an explicit replacement when the new image does not ship Corepack, and pass the Worker and container validation suites. Dependabot may continue proposing patch and minor updates within the supported Node major.

## Prior requests

- #9: Dependabot Node 24 to Node 26 Docker image update
