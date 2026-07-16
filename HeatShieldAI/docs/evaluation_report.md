# HeatShieldAI Model Evaluation Report

- Test samples: 2401
- Test accuracy: 0.9050
- Macro precision: 0.9055
- Macro recall: 0.9050
- Macro F1: 0.9052

## Classification Report

```
              precision    recall  f1-score   support

        SAFE       0.96      0.96      0.96       601
     WARNING       0.90      0.89      0.89       600
      DANGER       0.84      0.87      0.86       601
    CRITICAL       0.92      0.91      0.92       599

    accuracy                           0.91      2401
   macro avg       0.91      0.91      0.91      2401
weighted avg       0.91      0.91      0.91      2401

```

## Confusion Matrix

See `06_confusion_matrix.png`.

## Sample Predictions

| Features | True | Predicted | Confidence |
|---|---|---|---|
| Temperature=26.45, Humidity=47.70, HeartRate=108.60, SpO2=96.70, HeatIndex=27.87 | SAFE | SAFE | 63.0% |
| Temperature=35.93, Humidity=89.09, HeartRate=137.70, SpO2=96.30, HeatIndex=49.26 | DANGER | DANGER | 77.2% |
| Temperature=27.62, Humidity=31.74, HeartRate=104.40, SpO2=97.70, HeatIndex=27.48 | SAFE | SAFE | 83.9% |
| Temperature=26.24, Humidity=54.44, HeartRate=85.80, SpO2=97.10, HeatIndex=28.35 | SAFE | SAFE | 96.7% |
| Temperature=40.01, Humidity=61.48, HeartRate=181.60, SpO2=93.90, HeatIndex=50.92 | CRITICAL | CRITICAL | 96.3% |
| Temperature=40.31, Humidity=76.27, HeartRate=166.20, SpO2=91.80, HeatIndex=55.10 | CRITICAL | CRITICAL | 94.6% |
| Temperature=45.33, Humidity=81.87, HeartRate=146.60, SpO2=90.20, HeatIndex=67.55 | CRITICAL | CRITICAL | 93.7% |
| Temperature=42.06, Humidity=89.06, HeartRate=161.40, SpO2=92.00, HeatIndex=62.14 | CRITICAL | CRITICAL | 96.6% |
| Temperature=38.92, Humidity=60.64, HeartRate=136.90, SpO2=96.70, HeatIndex=48.79 | DANGER | DANGER | 70.7% |
| Temperature=37.84, Humidity=78.85, HeartRate=143.50, SpO2=93.60, HeatIndex=50.86 | CRITICAL | DANGER | 92.3% |
