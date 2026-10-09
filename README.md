# An improved Agent-Based Model of the UK Housing Market

This is an agent-based model (ABM) of the UK housing market improved by [Max Stoddard](https://www.linkedin.com/in/maxstoddard) at Imperial College London for his BEng Computing final-year project. This project was completed in collaboration with the Bank of England and was awarded First-Class Honours, the highest academic classification awarded in UK undergraduate studies. A full write-up of the project's details and methodology can be found in the [report](docs/beng-project/Project%20Final%20Report.pdf).

The model is intended for use as a tool to inform central bank regulatory policy. The original ABM that this project improved was written by the Institute of New Economic Thinking at the University of Oxford, also in collaboration with the Bank of England ([GitHub](https://github.com/INET-Complexity/housing-model)).

The model itself incorporates owner-occupiers, renters, buy-to-let investors, a housing market, a rental market, banks, a central bank and a government. The model itself is contained in [this folder](src/main/java) and a system architecture diagram is collected below.

![ABM architecture diagram](docs/beng-project/abm%20diagram.png)

A more detailed description of the original model can be found as a
[Bank of England Working Paper](https://www.bankofengland.co.uk/working-paper/2016/macroprudential-policy-in-an-agent-based-model-of-the-uk-housing-market) and in the [Original Model Description](docs/old-docs/ModelDescriptionFeb16.pdf).

## Project Contributions and Impact

This project produced five main contributions:

1. **Implementing a custom validation framework**: Developed a unified validation framework covering 20 housing and mortgage-market indicators, used to compare model accuracy and robustness.

2. **Improved computational performance**: Simulation performance was improved through caching and parallel execution, achieving 6.13x higher throughput and reducing batch runtime by 83.7% on a student laptop.

3. **New calibration methodology**: Reduced validation loss by 7.79% while requiring 99.3% fewer model runs than the original calibration method by using the modern Trust Region Bayesian Optimisation (TuRBO) method.

4. **Model target year update**: Recalibrated 59 of the model's 75 parameters which have publicly available data in the 2024 target year, producing a partially updated model representing the UK housing market in 2024.

5. **Full-stack ABM application**: Built a graphical interface, delivered as an AWS-hosted web application and Windows executable, enabling users to configure and run experiments, compare model versions, visualise parameters and analyse results without command-line tools or custom post-processing scripts.

The resulting system makes the model faster, easier to validate and substantially more accessible for research and policy assessment. Findings were presented to more than 20 Bank of England policymakers and analysts, and we were advised the improvements are being adopted for policy analysis.


## How to run this model

### Windows desktop app

For the simplest local workflow on 64-bit Windows 10 or 11, download the latest
`UK-Housing-Model-<version>-Setup.exe` from the
[GitHub Releases](../../releases) page.

Setup defaults to **Only for me**, which can install into a folder you can write
to without administrator permissions. **Anyone who uses this computer** is also
available and requires administrator permissions. Keep the suggested application
folder or choose another location in the setup wizard. When selecting a parent
folder, setup adds a **UK Housing Model** subfolder.

Upgrades reuse the existing installation folder unless you deliberately choose a
different destination. Use the installer to relocate the app; moving its folder
in File Explorer does not update its shortcuts or uninstall registration.

The app includes the dashboard, a bundled Java 25 runtime, the model, and supported
offline input-data snapshots. Open **Experiments** to run either:

- a **manual run**, using a selected baseline and model settings; or
- a **sensitivity run**, which varies one parameter across a defined range.

Results, logs, and generated configurations are retained locally under
`%APPDATA%\UK Housing Model\`. Choosing the application installation folder does
not change this data location. Normal uninstall preserves these files.


### Local dashboard

Use the dashboard when working from a local clone and you want a graphical way to
choose an input-data version, configure an experiment, monitor its progress, and
inspect results.

This route requires Node.js 22 and a Java 25 JDK. From the repository root, run:

```bash
./run-dashboard.sh
```

Then open http://localhost:5421 and use the Experiments page. The startup script installs dashboard dependencies when needed, and dashboard-managed runs compile and launch the Java model with the repository's Maven wrapper.

See the [dashboard documentation](dashboard/README.md) for development and runtime details.

## AWS Architecture

As part of this project, I also produced a full-stack application for remotely running experiments on a cloud-hosted version of this model. This cloud-hosted version is currently offline due to a lack of funding. Its deployment automation is defined in the [Dashboard CI workflow](.github/workflows/dashboard-ci.yml), and its API container is defined in the [API Dockerfile](dashboard/Dockerfile.api). The architecture for this system is presented below:

![AWS architecture diagram](docs/beng-project/aws%20architecture%20diagram.png)


<!-- ### Command line

Use the command line for reproducible research runs and automation. It requires a Java 25 JDK; Maven itself is provided through the repository's mvnw wrapper.

First, verify the Java model builds successfully:

```bash
./mvnw -q test
```

Then select a model version from the [model versions](input-data-versions) folder. -->
