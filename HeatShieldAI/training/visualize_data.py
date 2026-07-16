"""
visualize_data.py
==================
Generates exploratory data-visualization plots for the HeatShieldAI dataset
and saves them into docs/. Run this after generate_dataset.py.

Plots produced:
  - docs/01_feature_distributions.png  (histograms of each feature)
  - docs/02_class_balance.png          (bar chart of class counts)
  - docs/03_correlation_matrix.png     (feature correlation heatmap)
  - docs/04_scatter_matrix.png         (pairwise scatter, colored by class)
"""

import os
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

from common import FEATURE_NAMES, CLASS_NAMES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET_PATH = os.path.join(ROOT, "dataset", "heat_stress_dataset.csv")
DOCS_DIR = os.path.join(ROOT, "docs")

CLASS_PALETTE = {
    "SAFE": "#2ca02c",
    "WARNING": "#f1c40f",
    "DANGER": "#e67e22",
    "CRITICAL": "#c0392b",
}


def main():
    os.makedirs(DOCS_DIR, exist_ok=True)
    sns.set_theme(style="whitegrid")

    df = pd.read_csv(DATASET_PATH)
    df["Label"] = pd.Categorical(df["Label"], categories=CLASS_NAMES, ordered=True)

    # 1. Feature distributions (histograms)
    fig, axes = plt.subplots(2, 3, figsize=(16, 9))
    axes = axes.flatten()
    for i, feature in enumerate(FEATURE_NAMES):
        sns.histplot(data=df, x=feature, hue="Label", palette=CLASS_PALETTE,
                     element="step", stat="density", common_norm=False, ax=axes[i])
        axes[i].set_title(f"{feature} distribution")
    axes[-1].axis("off")
    fig.suptitle("HeatShieldAI - Feature Distributions by Class", fontsize=16)
    fig.tight_layout()
    fig.savefig(os.path.join(DOCS_DIR, "01_feature_distributions.png"), dpi=150)
    plt.close(fig)

    # 2. Class balance
    fig, ax = plt.subplots(figsize=(7, 5))
    counts = df["Label"].value_counts().reindex(CLASS_NAMES)
    bars = ax.bar(counts.index, counts.values, color=[CLASS_PALETTE[c] for c in counts.index])
    ax.set_title("Class Balance")
    ax.set_ylabel("Number of samples")
    for bar in bars:
        height = bar.get_height()
        ax.annotate(f"{int(height)}", (bar.get_x() + bar.get_width() / 2, height),
                    ha="center", va="bottom")
    fig.tight_layout()
    fig.savefig(os.path.join(DOCS_DIR, "02_class_balance.png"), dpi=150)
    plt.close(fig)

    # 3. Correlation matrix
    fig, ax = plt.subplots(figsize=(7, 6))
    corr = df[FEATURE_NAMES].corr()
    sns.heatmap(corr, annot=True, fmt=".2f", cmap="coolwarm", vmin=-1, vmax=1, ax=ax)
    ax.set_title("Feature Correlation Matrix")
    fig.tight_layout()
    fig.savefig(os.path.join(DOCS_DIR, "03_correlation_matrix.png"), dpi=150)
    plt.close(fig)

    # 4. Pairwise scatter matrix colored by class (subsampled for readability)
    sample_df = df.sample(n=min(2500, len(df)), random_state=42)
    g = sns.pairplot(sample_df, vars=FEATURE_NAMES, hue="Label",
                      palette=CLASS_PALETTE, plot_kws={"alpha": 0.5, "s": 12},
                      diag_kind="kde", corner=True)
    g.fig.suptitle("HeatShieldAI - Pairwise Feature Scatter", y=1.02, fontsize=16)
    g.savefig(os.path.join(DOCS_DIR, "04_scatter_matrix.png"), dpi=150)
    plt.close(g.fig)

    print(f"Saved 4 visualization plots to {DOCS_DIR}")


if __name__ == "__main__":
    main()
