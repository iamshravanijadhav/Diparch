# HeatShieldAI Quantized (INT8) Model Evaluation Report

- Model file: `heatshield_model.tflite` (3912 bytes, 3.82 KB)
- Test samples: 2401
- Input quantization: scale=0.02014534, zero_point=8
- Output quantization: scale=0.00390625, zero_point=-128
- Test accuracy: 0.9025
- Macro precision: 0.9032
- Macro recall: 0.9025
- Macro F1: 0.9028

## Classification Report

```
              precision    recall  f1-score   support

        SAFE       0.95      0.96      0.96       601
     WARNING       0.90      0.89      0.89       600
      DANGER       0.84      0.87      0.85       601
    CRITICAL       0.92      0.90      0.91       599

    accuracy                           0.90      2401
   macro avg       0.90      0.90      0.90      2401
weighted avg       0.90      0.90      0.90      2401

```

See `07_quantized_confusion_matrix.png` for the confusion matrix.
