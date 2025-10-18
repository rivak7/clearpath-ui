import torch
import torch.nn as nn
import torchvision.models as tv


class EntranceRegressor(nn.Module):
    def __init__(self, pretrained: bool = True):
        super().__init__()
        m = tv.resnet18(
            weights=tv.ResNet18_Weights.IMAGENET1K_V1 if pretrained else None
        )
        in_features = m.fc.in_features
        m.fc = nn.Linear(in_features, 2)
        self.net = m

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = self.net(x)
        # Use sigmoid to bound to [0,1] space
        return torch.sigmoid(out)
