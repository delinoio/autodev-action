import * as core from "@actions/core";
import * as github from "@actions/github";
import { HttpClient } from "@actions/http-client";
import { execSync } from "child_process";

async function run(): Promise<void> {
  try {
    // Get inputs
    const workflowExecutionToken = core.getInput(
      "autodev_workflow_execution_token",
      { required: true }
    );
    if (!workflowExecutionToken) {
      core.warning("No task token provided");
      return;
    }

    const delinoAccessToken = core.getInput("delino_access_token", {
      required: true,
    });
    const baseBranch = core.getInput("base_branch", { required: false });
    const autodevMode =
      core.getInput("autodev_mode", { required: false }) || "develop";

    // Get GitHub context
    const context = github.context;
    const runId = context.runId.toString();
    // Prepare the API URL
    const baseUrl =
      process.env.AUTODEV_API_URL || "https://devbird.api.delino.io";
    // Create HTTP client
    const http = new HttpClient("autodev-action");

    async function linkGitHubAction() {
      core.info(`Linking GitHub Action run ${runId} to task using token`);

      const linkEndpoint = `${baseUrl}/delino.devbird.v1.DevBird/LinkGitHubActionByToken`;

      // Prepare request body
      const linkRequestBody = JSON.stringify({
        workflow_execution_token: workflowExecutionToken,
        github_run_id: runId,
      });

      // Make the API call with OAuth token
      const linkResponse = await http.post(linkEndpoint, linkRequestBody, {
        "Content-Type": "application/json",
        Authorization: `Bearer ${delinoAccessToken}`,
      });

      const linkStatusCode = linkResponse.message.statusCode;
      const linkBody = await linkResponse.readBody();

      if (linkStatusCode !== 200) {
        core.warning(`Failed to link GitHub Action: ${linkBody}`);
        return;
      }

      const linkResult = JSON.parse(linkBody);
      if (linkResult.success) {
        core.info(
          `Successfully linked GitHub Action run to task: ${linkResult.message}`
        );
      } else {
        core.warning(`Failed to link GitHub Action: ${linkResult.message}`);
      }
    }

    async function detectBranches() {
      // Detect newly created branches
      core.info("Detecting newly created branches...");

      try {
        // Get all local branches, excluding the base branch
        const defaultBaseBranch = baseBranch || "main"; // Use provided base branch or default to 'main'
        const branchCommand = `git branch --format='%(refname:short)' | grep -v '^${defaultBaseBranch}$' | head -20`;
        const branchOutput = execSync(branchCommand, {
          encoding: "utf-8",
          cwd: process.cwd(),
        }).trim();

        const branches = !branchOutput
          ? []
          : branchOutput
              .split("\n")
              .map((b) => b.trim())
              .filter((b) => b.length > 0);

        core.info(`Found ${branches.length} branches: ${branches.join(", ")}`);

        // Send branches to the server
        const branchEndpoint = `${baseUrl}/delino.devbird.v1.DevBird/RegisterBranchesByToken`;
        const branchRequestBody = JSON.stringify({
          workflow_execution_token: workflowExecutionToken,
          branch_names: branches,
        });

        const branchResponse = await http.post(
          branchEndpoint,
          branchRequestBody,
          {
            "Content-Type": "application/json",
            Authorization: `Bearer ${delinoAccessToken}`,
          }
        );

        const branchStatusCode = branchResponse.message.statusCode;
        const branchBody = await branchResponse.readBody();

        if (branchStatusCode !== 200) {
          core.warning(`Failed to register branches: ${branchBody}`);
        } else {
          const branchResult = JSON.parse(branchBody);
          if (branchResult.success) {
            core.info(
              `Successfully registered branches: ${branchResult.message}`
            );
            if (
              branchResult.registered_pull_requests &&
              branchResult.registered_pull_requests.length > 0
            ) {
              core.info(
                `Found ${branchResult.registered_pull_requests.length} existing PRs for these branches`
              );
            }
          } else {
            core.warning(
              `Failed to register branches: ${branchResult.message}`
            );
          }
        }
      } catch (branchError) {
        core.warning(`Error detecting branches: ${branchError}`);
      }
    }

    async function uploadPlanFiles() {
      // Detect and upload plan files (PLAN-*.yaml)
      core.info("Detecting plan files...");

      try {
        const planFiles = execSync("ls PLAN-*.yaml 2>/dev/null || true", {
          encoding: "utf-8",
          cwd: process.cwd(),
        }).trim();

        if (planFiles) {
          const planFileList = planFiles
            .split("\n")
            .map((f) => f.trim())
            .filter((f) => f.length > 0);

          for (const planFile of planFileList) {
            core.info(`Found plan file: ${planFile}`);

            try {
              // Read the plan file content
              const planContent = execSync(`cat ${planFile}`, {
                encoding: "utf-8",
                cwd: process.cwd(),
              });

              // Upload the plan to the server
              const planEndpoint = `${baseUrl}/delino.devbird.v1.DevBird/UploadTaskGraphPlanByToken`;
              const planRequestBody = JSON.stringify({
                workflow_execution_token: workflowExecutionToken,
                plan_filename: planFile,
                plan_content: planContent,
              });

              const planResponse = await http.post(
                planEndpoint,
                planRequestBody,
                {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${delinoAccessToken}`,
                }
              );

              const planStatusCode = planResponse.message.statusCode;
              const planBody = await planResponse.readBody();

              if (planStatusCode !== 200) {
                core.warning(
                  `Failed to upload plan file ${planFile}: ${planBody}`
                );
              } else {
                const planResult = JSON.parse(planBody);
                if (planResult.success) {
                  core.info(
                    `Successfully uploaded plan file ${planFile}: ${planResult.message}`
                  );
                } else {
                  core.warning(
                    `Failed to upload plan file ${planFile}: ${planResult.message}`
                  );
                }
              }
            } catch (fileError) {
              core.warning(
                `Error processing plan file ${planFile}: ${fileError}`
              );
            }
          }
        } else {
          core.info("No plan files found to upload");
        }
      } catch (planError) {
        core.warning(`Error detecting plan files: ${planError}`);
      }
    }

    // Execute different actions based on autodev_mode
    if (autodevMode === "plan") {
      core.info("Running in plan mode - only uploading plan files");
      await Promise.all([linkGitHubAction(), uploadPlanFiles()]);
    } else {
      core.info("Running in develop mode - only detecting branches");
      await Promise.all([linkGitHubAction(), detectBranches()]);
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("Unknown error occurred");
    }
  }
}

run();
