# Set up passwordless publishing to the Visual Studio Marketplace

## Goal

Set up passwordless publishing of my VS Code extension to the Visual Studio Marketplace with Microsoft Entra ID (workload identity federation and a user-assigned managed identity). Do not create or use a Personal Access Token. Global PATs in Azure DevOps are retired on 1 December 2026.

## Context

- Azure DevOps organization: https://dev.azure.com/integrationsonline/
- Project (private, already created): `vscode-extensions`
- Marketplace publisher (already created, I am Owner): `integrations-at`, https://marketplace.visualstudio.com/manage/publishers/integrations-at
- Extension repo on this machine: `D:\git-projects\claude-harness`
  - `package.json`: name `claude-harness`, publisher `integrations-at`, devDependency `@vscode/vsce ^4.0.0`
  - script `vscode:prepublish` compiles with `tsc`
- My account: alexander.kastil@integrations.at, Entra tenant "Integrations IT Solutions"
- Reference: https://code.visualstudio.com/api/working-with-extensions/publishing-extension (section "Secure automated publishing to Visual Studio Marketplace")

## Ground rules

- Before creating any Azure resource, role assignment or Azure DevOps permission, list exactly what you will create (name, scope, role) and wait for my yes.
- Give the managed identity the Reader role only, at subscription scope. No Owner or Contributor on the subscription.
- No PATs, client secrets or certificates. If a step seems to need one, stop and ask.
- Never print or commit tokens or secrets. Client ID, tenant ID, subscription ID and resource IDs are not secrets and may be shown.
- Do not delete anything. Do not click Verify domain in the Marketplace. Do not publish the extension until I say so.
- If a step is UI-only and you have no browser tool, give me the exact click path instead of skipping it.
- After 2 or 3 failed attempts at the same step, stop and tell me what you tried.

## Steps

### 1. Preflight

- Run `az login` for the Integrations IT Solutions tenant, list the subscriptions and ask me which one to use.
- Check that the `integrationsonline` organization is connected to the same Entra tenant (Organization settings > Microsoft Entra).
- Check Organization settings > Parallel jobs for Microsoft-hosted jobs on private projects. If none are available, tell me before continuing.
- Propose names and a region. Defaults:
  - resource group `rg-vscode-publishing`
  - managed identity `id-vscode-marketplace-publisher`
  - service connection `sc-vscode-marketplace`
  - region `westeurope`

### 2. Draft the service connection (Azure DevOps UI)

- Open `vscode-extensions` > Project settings > Service connections > New service connection > Azure Resource Manager > Workload Identity federation (manual).
- Use the name above and continue until the Issuer and Subject identifier are shown. Record both and save the connection as a draft.

### 3. Create the managed identity (Azure)

- Create the resource group and the user-assigned managed identity.
- Assign Reader at subscription scope.
- Record `clientId`, `principalId`, `tenantId` and `subscriptionId`.

### 4. Add the federated credential to the managed identity

- Issuer and subject from step 2.
- Audience `api://AzureADTokenExchange`.
- Credential name `ado-vscode-extensions`.

### 5. Finish the service connection

- Reopen the draft, enter subscription ID, subscription name, client ID and tenant ID, then Verify and save.
- Grant access to the pipelines that will publish. Do not use "grant access to all pipelines" unless I approve.

### 6. Get the identity ID that the Marketplace needs (one-time)

- Pipeline source: ask me first whether to use the default Azure Repos repo in `vscode-extensions` or the GitHub repo `alexander-kastil/claude-harness`. The GitHub option needs me to approve the Azure Pipelines GitHub app.
- Run a temporary pipeline with an `AzureCLI@2` task that uses `sc-vscode-marketplace` and runs:

  ```
  az rest -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me --resource 499b84ac-1321-427f-aa17-267ca6975798
  ```

- Capture the `id` field from the JSON output and show it to me. Remove the temporary pipeline file afterwards.

### 7. Authorize the identity in the Marketplace

- Open https://marketplace.visualstudio.com/manage/publishers/integrations-at > Members and add the identity using the `id` from step 6, role Contributor.
- If you cannot do this in a browser, give me the exact steps.

### 8. Publishing pipeline for claude-harness

- Add `azure-pipelines.yml` to the repo root with `trigger: none` (manual run) and the pool `ubuntu-latest`.
- Steps: Node 20 or newer, `npm ci`, `npm install -g @vscode/vsce` (version 2.26.1 or newer), then `AzureCLI@2` with `azureSubscription: sc-vscode-marketplace` and `scriptType: bash`.
- Version 1 of the pipeline runs only:

  ```
  vsce package
  ```

- Prepare, but leave disabled behind a manual parameter `publish=false`, this step:

  ```
  vsce publish --azure-credential
  ```

- Run the package-only version and show me the result. Do not run the publish step.

### 9. Report

- A table of everything created (name, type, scope, IDs) and anything left for me.
- The exact commands or UI steps to undo each item.
