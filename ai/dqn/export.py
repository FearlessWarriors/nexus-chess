"""Export DQN model to JSON for browser inference.

Usage: python -m dqn.export --model dqn_best.pth --output ../frontend/public/dqn_weights.json
"""

import json
import torch
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dqn.model import GravityDQN


def export_to_json(model_path: str, output_path: str):
    """Export PyTorch model weights to a JSON file for pure JS inference."""
    model = GravityDQN()
    state = torch.load(model_path, map_location='cpu', weights_only=True)

    # Handle checkpoint dict
    if isinstance(state, dict) and 'model' in state:
        state = state['model']

    model.load_state_dict(state)
    model.eval()

    layers = []
    for name, param in model.named_parameters():
        if 'weight' in name:
            shape = list(param.shape)
            values = param.detach().cpu().numpy().flatten().tolist()
            layers.append({
                'type': 'weight',
                'shape': shape,
                'values': values,
            })
        elif 'bias' in name:
            values = param.detach().cpu().numpy().flatten().tolist()
            layers.append({
                'type': 'bias',
                'shape': list(param.shape),
                'values': values,
            })

    result = {
        'architecture': [392, 512, 256, 128, 1],
        'activations': ['linear', 'relu', 'relu', 'relu', 'tanh'],
        'layers': layers,
    }

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(result, f)

    print(f'Exported {len(layers)} parameter tensors to {output_path}')
    print(f'Total params: {sum(p.numel() for p in model.parameters()):,}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default='dqn_best.pth')
    parser.add_argument('--output', default='../frontend/public/dqn_weights.json')
    args = parser.parse_args()
    export_to_json(args.model, args.output)
