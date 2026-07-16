// inference.cpp
// See inference.h for the contract this file implements.
//
// API pattern follows Chirale_TensorFlowLite's verified hello_world example
// (https://github.com/spaziochirale/Chirale_TensorFlowLite) -- same header
// includes, same tflite::GetModel()/MicroInterpreter/AllocateTensors() flow,
// same input->params.scale/zero_point quantization pattern.

#include "inference.h"
#include "model.h"  // g_heatshield_model, g_heatshield_model_len

#include <math.h>
#include <stdio.h>

#include <Chirale_TensorFlowLite.h>
#include "tensorflow/lite/micro/all_ops_resolver.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/schema/schema_generated.h"

// NOTE ON OP RESOLVER: we use AllOpsResolver here to guarantee every op the
// converter might emit is available, which is the safest default for a
// hackathon deliverable that must compile first try. We confirmed by
// inspecting the actual .tflite flatbuffer (see
// training/generate_model_header.py output / README "Model Architecture")
// that this model only uses FULLY_CONNECTED and SOFTMAX. If you need to
// shave flash usage, AllOpsResolver can be swapped for:
//
//   #include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
//   static tflite::MicroMutableOpResolver<2> resolver;
//   resolver.AddFullyConnected();
//   resolver.AddSoftmax();
//
// If you change the model architecture (add layers/activations), re-check
// the op list before doing this, or stick with AllOpsResolver.

bool TinyMLInference::begin() {
    const tflite::Model* model = tflite::GetModel(g_heatshield_model);

    if (model->version() != TFLITE_SCHEMA_VERSION) {
        snprintf(errorMessage_, sizeof(errorMessage_),
                 "Schema mismatch: model=%lu lib=%d",
                 (unsigned long)model->version(), TFLITE_SCHEMA_VERSION);
        initialized_ = false;
        return false;
    }

    static tflite::AllOpsResolver resolver;
    static tflite::MicroInterpreter static_interpreter(
        model, resolver, tensorArena_, HEATSHIELD_TENSOR_ARENA_SIZE);
    interpreter_ = &static_interpreter;

    TfLiteStatus allocate_status = interpreter_->AllocateTensors();
    if (allocate_status != kTfLiteOk) {
        snprintf(errorMessage_, sizeof(errorMessage_),
                 "AllocateTensors() failed (arena too small?)");
        initialized_ = false;
        return false;
    }

    input_ = interpreter_->input(0);
    output_ = interpreter_->output(0);

    // Sanity-check tensor shapes match what we expect. This catches a stale
    // model.h/model_params.h pair (e.g. retrained with a different feature
    // or class count but only one of the two files got regenerated).
    bool inputOk = input_->dims->size == 2 &&
                   input_->dims->data[1] == HEATSHIELD_NUM_FEATURES;
    bool outputOk = output_->dims->size == 2 &&
                    output_->dims->data[1] == HEATSHIELD_NUM_CLASSES;
    if (!inputOk || !outputOk) {
        snprintf(errorMessage_, sizeof(errorMessage_),
                 "Tensor shape mismatch (in=%d out=%d)",
                 inputOk ? 1 : 0, outputOk ? 1 : 0);
        initialized_ = false;
        return false;
    }

    initialized_ = true;
    errorMessage_[0] = '\0';
    return true;
}

bool TinyMLInference::predict(const float normalizedFeatures[HEATSHIELD_NUM_FEATURES],
                               InferenceResult& result) {
    if (!initialized_) {
        return false;
    }

    // Quantize float -> int8 using the LIVE tensor's own quantization
    // parameters (input_->params), not the copy in model_params.h. This is
    // self-consistent by construction: it can never drift from the model
    // actually loaded, even if model_params.h were somehow stale.
    for (int i = 0; i < HEATSHIELD_NUM_FEATURES; i++) {
        float scaled = normalizedFeatures[i] / input_->params.scale + input_->params.zero_point;
        long q = lroundf(scaled);
        if (q < -128) q = -128;
        if (q > 127) q = 127;
        input_->data.int8[i] = (int8_t)q;
    }

    unsigned long startUs = micros();
    TfLiteStatus invokeStatus = interpreter_->Invoke();
    unsigned long endUs = micros();

    if (invokeStatus != kTfLiteOk) {
        snprintf(errorMessage_, sizeof(errorMessage_), "Invoke() failed");
        return false;
    }

    float maxProb = -1.0f;
    int argmaxClass = 0;
    for (int i = 0; i < HEATSHIELD_NUM_CLASSES; i++) {
        int8_t q = output_->data.int8[i];
        float p = (q - output_->params.zero_point) * output_->params.scale;
        result.probabilities[i] = p;
        if (p > maxProb) {
            maxProb = p;
            argmaxClass = i;
        }
    }

    result.predictedClass = argmaxClass;
    result.confidence = maxProb;
    result.inferenceTimeUs = endUs - startUs;
    return true;
}

size_t TinyMLInference::tensorArenaUsedBytes() const {
    if (!initialized_ || interpreter_ == nullptr) {
        return 0;
    }
    return interpreter_->arena_used_bytes();
}

size_t TinyMLInference::modelSizeBytes() const {
    return g_heatshield_model_len;
}
