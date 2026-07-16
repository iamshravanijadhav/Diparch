// inference.h
// ------------
// TinyMLInference: thin wrapper around TensorFlow Lite Micro (via the
// Chirale_TensorFlowLite Arduino port) that loads the embedded model
// (model.h), allocates the tensor arena, and runs quantized INT8 inference.

#ifndef HEATSHIELD_INFERENCE_H
#define HEATSHIELD_INFERENCE_H

#include <Arduino.h>
#include "model_params.h"

// Forward-declare TFLite Micro types so this header doesn't force every
// includer to pull in the whole TFLite Micro header tree.
namespace tflite {
class MicroInterpreter;
}
struct TfLiteTensor;

struct InferenceResult {
    float probabilities[HEATSHIELD_NUM_CLASSES];
    int predictedClass;
    float confidence;            // probabilities[predictedClass], 0.0-1.0
    unsigned long inferenceTimeUs;
};

class TinyMLInference {
public:
    // Loads the model, builds the interpreter, and allocates tensors.
    // Returns false (never crashes/hangs) on any failure -- schema version
    // mismatch, tensor allocation failure, or unexpected input/output
    // tensor shape. Check errorMessage() after a false return.
    bool begin();

    // Runs one inference. `normalizedFeatures` must already be standardized
    // (see FeatureProcessor::normalize). Returns false if begin() was never
    // called successfully or Invoke() fails; `result` is left untouched in
    // that case, so callers must check the return value.
    bool predict(const float normalizedFeatures[HEATSHIELD_NUM_FEATURES], InferenceResult& result);

    bool isReady() const { return initialized_; }
    const char* errorMessage() const { return errorMessage_; }

    // Diagnostics, used for the required Serial debug output.
    size_t tensorArenaSizeBytes() const { return HEATSHIELD_TENSOR_ARENA_SIZE; }
    size_t tensorArenaUsedBytes() const;
    size_t modelSizeBytes() const;

private:
    bool initialized_ = false;
    char errorMessage_[64] = "";

    tflite::MicroInterpreter* interpreter_ = nullptr;
    TfLiteTensor* input_ = nullptr;
    TfLiteTensor* output_ = nullptr;

    alignas(16) uint8_t tensorArena_[HEATSHIELD_TENSOR_ARENA_SIZE];
};

#endif  // HEATSHIELD_INFERENCE_H
