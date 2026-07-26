"""Report system RAM/VRAM and suggest a local open-weights model size.

Developer utility for the planned open-weights model support (see ROADMAP.md).
Run it directly: `python scripts/hardware_check.py`.
"""

from __future__ import annotations

import platform
import subprocess


def get_total_ram_gb() -> float:
    try:
        import psutil

        return psutil.virtual_memory().total / (1024**3)
    except ImportError:
        pass

    try:
        if platform.system() == "Windows":
            output = subprocess.check_output(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    "(Get-CimInstance Win32_PhysicalMemory"
                    " | Measure-Object -Property Capacity -Sum).Sum",
                ]
            )
            return float(output.decode().strip()) / (1024**3)

        with open("/proc/meminfo", encoding="utf-8") as handle:
            for line in handle:
                if "MemTotal" in line:
                    return float(line.split()[1]) / (1024**2)
    except Exception as exc:
        print(f"Failed to read RAM: {exc}")
    return 0.0


def get_gpu_vram_gb() -> float:
    try:
        output = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"]
        )
        return float(output.decode().splitlines()[0].strip()) / 1024
    except FileNotFoundError:
        print("No NVIDIA GPU found or nvidia-smi not installed.")
    except Exception as exc:
        print(f"Failed to read GPU VRAM: {exc}")
    return 0.0


def recommend_model(ram_gb: float, vram_gb: float) -> str:
    # Thresholds sit just under each nominal tier: a "16 GB" card reports ~15.9 GB
    # of usable VRAM, so comparing against a flat 16 would demote it a tier.
    if vram_gb >= 23.5:
        return "Gemma 30 / Qwen 3.5 32B (4-bit or 8-bit quantization, fully on GPU)"
    if vram_gb >= 15.5:
        return "Qwen 3.5 14B / Gemma 2 9B (fully offloaded to GPU for fast generation)"
    if vram_gb >= 7.5:
        return "Qwen 3.5 7B / Llama 3 8B (fits in 8GB VRAM with 4-bit quantization)"
    if vram_gb >= 3.5:
        return "Qwen 3.5 3B / Phi-3 Mini (fits in limited VRAM)"
    if ram_gb >= 15.5:
        return "Qwen 3.5 7B (CPU inference: slower, but enough system RAM)"
    return "Qwen 3.5 1.5B or Gemma 2 2B (smallest models, for low RAM / CPU-only setups)"


if __name__ == "__main__":
    ram = get_total_ram_gb()
    vram = get_gpu_vram_gb()
    print("System hardware detected:")
    print(f"- System RAM: {ram:.1f} GB")
    print(f"- GPU VRAM:   {vram:.1f} GB")
    print("-" * 30)
    print("Recommendation:")
    print(recommend_model(ram, vram))
