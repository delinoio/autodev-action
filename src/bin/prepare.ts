import * as core from "@actions/core";
import * as github from "@actions/github";
import { HttpClient } from "@actions/http-client";

async function run(): Promise<void> {
  try {
    // Get inputs
    const workflowExecutionToken = core.getInput(
      "autodev_workflow_execution_token",
      { required: true }
    );
    const delinoAccessToken = core.getInput("delino_access_token", {
      required: false, // Make it optional since we might use OIDC
    });
    const baseBranch = core.getInput("base_branch", { required: false });
    const agent = core.getInput("agent", { required: true });
    const agentModel = core.getInput("agent_model", { required: false });

    // Get GitHub context
    const context = github.context;

    // Try to get GitHub token via OIDC if available
    let githubToken = "";

    try {
      // Request OIDC token from GitHub Actions
      core.info("Requesting GitHub OIDC token...");
      const oidcToken = await core.getIDToken();

      if (oidcToken) {
        core.info(
          "OIDC token obtained, exchanging for GitHub App installation token..."
        );

        // Exchange OIDC token for GitHub App installation token
        const baseUrl =
          process.env.AUTODEV_API_URL || "https://devbird.api.delino.io";
        const endpoint = `${baseUrl}/delino.devbird.v1.DevBird/ExchangeOIDCTokenForGitHubToken`;

        const http = new HttpClient("autodev-action");
        const requestBody = JSON.stringify({
          oidc_token: oidcToken,
          repository_owner: context.repo.owner,
          repository_name: context.repo.repo,
        });

        const response = await http.post(endpoint, requestBody, {
          "Content-Type": "application/json",
        });

        const statusCode = response.message.statusCode;
        const body = await response.readBody();

        if (statusCode === 200) {
          const result = JSON.parse(body);
          if (result.success && result.githubToken) {
            githubToken = result.githubToken;
            core.info(
              "Successfully obtained GitHub App installation token via OIDC"
            );
            // Export the token for subsequent steps
            core.setSecret(githubToken);
            core.exportVariable("githubToken", githubToken);
            core.setOutput("github_token", githubToken);
          } else {
            core.warning(
              `Failed to exchange OIDC token: ${JSON.stringify(result)}`
            );
          }
        } else {
          core.warning(`Failed to exchange OIDC token: HTTP ${statusCode}`);
        }
      }
    } catch (oidcError) {
      core.info("OIDC token not available, will use provided tokens");
      core.debug(`OIDC error: ${oidcError}`);
    }

    // Log preparation info
    core.info(`Preparing AutoDev environment for ${agent} agent`);
    core.info(`Repository: ${context.repo.owner}/${context.repo.repo}`);
    core.info(`Base branch: ${baseBranch || "default"}`);

    // Set outputs for subsequent steps
    core.setOutput("workflow_execution_token", workflowExecutionToken);
    core.setOutput("agent", agent);
    core.setOutput("agent_model", agentModel);
    core.setOutput("githubToken_obtained", githubToken ? "true" : "false");

    // Link the GitHub Action run to the task (if we have access token)
    if (delinoAccessToken && workflowExecutionToken) {
      const runId = context.runId.toString();
      core.info(`Linking GitHub Action run ${runId} to task`);

      try {
        const baseUrl =
          process.env.AUTODEV_API_URL || "https://devbird.api.delino.io";
        const endpoint = `${baseUrl}/delino.devbird.v1.DevBird/LinkGitHubActionByToken`;

        const http = new HttpClient("autodev-action");
        const requestBody = JSON.stringify({
          workflow_execution_token: workflowExecutionToken,
          github_run_id: runId,
        });

        const response = await http.post(endpoint, requestBody, {
          "Content-Type": "application/json",
          Authorization: `Bearer ${delinoAccessToken}`,
        });

        const statusCode = response.message.statusCode;
        const body = await response.readBody();

        if (statusCode === 200) {
          const result = JSON.parse(body);
          if (result.success) {
            core.info(
              `Successfully linked GitHub Action run to task: ${result.message}`
            );
          } else {
            core.warning(`Failed to link GitHub Action: ${result.message}`);
          }
        } else {
          core.warning(`Failed to link GitHub Action: HTTP ${statusCode}`);
        }
      } catch (linkError) {
        core.warning(`Error linking GitHub Action: ${linkError}`);
      }
    }

    core.info("Preparation complete");
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("Unknown error occurred");
    }
  }
}

run();
