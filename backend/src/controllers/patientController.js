import { Patient } from "../Models/patient.models.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { PatientToken } from "../Models/patientToken.models.js";
import { Doctor } from "../Models/doctor.models.js";
import { Department } from "../Models/department.models.js";
// import generateToken from "../utils/generateToken.js";
const options = {
  httpOnly: true,
  secure: true,
  sameSite: "None",
};
const generatePatientToken = async (patientId) => {
  try {
    console.log("➡️ Starting generatePatientToken for patientId:", patientId);

    const today = new Date();
    today.setHours(1, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];

    console.log("📅 Today's date string:", todayStr);

    // Find existing token for today
    let tokenData = await PatientToken.findOne({ date: todayStr });
    console.log("🔍 Existing tokenData:", tokenData);

    const patient = await Patient.findById(patientId);
    if (!patient) {
      console.error("❌ ERROR: Patient not found!");
      throw new ApiError(404, "Patient not found");
    }

    console.log("🧑‍⚕️ Fetched patient:", patient);

    const department = await Department.findById(patient.department);
    console.log("🏥 Fetched department:", department);

    let assignedDoctor = patient.isNewPatient
      ? await Doctor.findOne({ department: department._id }).sort({
          patients: 1,
        })
      : patient.doctor;

    console.log("👨‍⚕️ Assigned Doctor:", assignedDoctor);

    if (!tokenData) {
      console.log("⚠️ No existing tokenData found. Creating a new one...");

      // Generate a unique token
      const generatedToken = `TOKEN-${Date.now()}-${Math.floor(
        Math.random() * 1000
      )}`;

      tokenData = await PatientToken.create({
        token: generatedToken,
        date: todayStr,
        lastTokenNo: 1,
        department: patient.department,
        doctor: assignedDoctor ? assignedDoctor._id : null,
        patient: patient._id,
      });
    } else {
      console.log("🔄 Incrementing lastTokenNo...");
      tokenData.lastTokenNo += 1;
      await tokenData.save();
    }

    console.log(
      "📌 Populating patient token with doctor & department details..."
    );

    // ✅ Populate doctor & department name inside tokenData
    await tokenData.populate([
      { path: "doctor", select: "name" },
      { path: "department", select: "name" },
    ]);

    // Update patient with the latest token reference
    patient.patientToken = tokenData._id;
    await patient.save({ validateBeforeSave: false });

    console.log(
      "✅ generatePatientToken SUCCESSFUL! Returning tokenData:",
      tokenData
    );
    return tokenData;
  } catch (error) {
    console.error("❌ ERROR in generatePatientToken:", error);
    throw new ApiError(500, "Error generating token in generatePatientToken");
  }
};

const generateAcessTokenAndRefreshToken = async (patientId) => {
  try {
    const patient = await Patient.findById(patientId);
    const accessToken = patient.generateAcessToken();
    const refreshToken = patient.generateRefreshToken();
    patient.refreshToken = refreshToken;
    await patient.save({ validateBeforeSave: false });
    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      "Error generating tokens in generateAcessTokenAndRefreshToken"
    );
  }
};
const register = asyncHandler(async (req, res) => {
  const { name, age, email, password, phoneNumber, isNewPatient, department } =
    req.body;
  console.log("req.body in register", req.body);
  const patientExists = await Patient.findOne({ name });

  if (patientExists) {
    throw new ApiError(400, "User already exists");
  }
  const medicalHistoryPath = req.file?.path;

  if (!medicalHistoryPath) {
    throw new ApiError(400, "Medical history is required");
  }

  const medicalHistory = await uploadOnCloudinary(medicalHistoryPath);
  if (!medicalHistory) {
    throw new ApiError(500, "Error uploading medical history");
  }

  let incomingDepartment = await Department.findOne({ name: department });

  if (!incomingDepartment) {
    throw (error = new ApiError(404, "Department not found"));
  }

  const patient = await Patient.create({
    name,
    email,
    password,
    age,
    phoneNumber,
    isNewPatient,
    department: incomingDepartment._id,
    medicalHistory: medicalHistory.url,
  });

  console.log("patient is created", patient);

  const createdPatient = await Patient.findById(patient._id).select(
    "-password -refreshToken"
  );

  return res
    .status(201)
    .json(new ApiResponse(201, createdPatient, "Patient created successfully"));
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  console.log(email, password);
  const patient = await Patient.findOne({ email });
  console.log("patient", patient);
  if (!patient) {
    throw new ApiError(404, "Patient not found");
  }

  const isPasswordCorrect = await patient.isPasswordCorrect(password);
  if (!isPasswordCorrect) {
    throw new ApiError(401, "Invalid credentials");
  }

  //   const accessToken = patient.generateAcessToken();
  //   const refreshToken = patient.generateRefreshToken();

  //   patient.refreshToken = refreshToken;
  //   await patient.save({ validateBeforeSave: false });

  const { accessToken, refreshToken } = await generateAcessTokenAndRefreshToken(
    patient._id
  );

  if (!accessToken || !refreshToken) {
    throw new ApiError(500, "Error generating tokens in patient login");
  }
  //
  // console.log("this is patientDepartment", patient.department);

  return res
    .status(200)
    .cookie("refreshToken", refreshToken, options)
    .cookie("accessToken", accessToken, options)
    .json(
      new ApiResponse(
        200,
        { patient, accessToken, refreshToken },
        "Patientlogged in successfully"
      )
    );
});

const getTokenNo = asyncHandler(async (req, res) => {
  try {
    const patient = await Patient.findById(req.patient._id);

    if (!patient) {
      throw new ApiError(404, "Patient not found");
    }

    let tokenData = patient?.patientToken;
    if (!tokenData) {
      tokenData = await generatePatientToken(patient._id);
      console.log("getting new token", tokenData);
    }

    return res
      .status(200)
      .json(
        new ApiResponse(200, tokenData, "Token number fetched successfully")
      );
  } catch (error) {
    throw new ApiError(500, error.message || "Error fetching token number");
  }
});
const logout = asyncHandler(async (req, res) => {
  await Patient.findByIdAndUpdate(
    req.patient._id,
    {
      $set: {
        refreshToken: undefined,
      },
    },
    {
      new: true,
    }
  );
  return res
    .status(200)
    .clearCookie("refreshToken")
    .clearCookie("accessToken")
    .json(new ApiResponse(200, {}, "Patient logged out successfully"));
});

const getMedicalRecord = asyncHandler(async (req, res) => {
  if (!req.patient || !req.patient.medicalHistory) {
    throw new ApiError(500, "not getting the info from verifyjwt");
  }
  const medicalHistory = req.patient.medicalHistory;
  console.log("getting the record ", medicalHistory);
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        medicalHistory,
        "successfull fetched patient medical History"
      )
    );
});
export {
  register,
  login,
  logout,
  generatePatientToken,
  getTokenNo,
  getMedicalRecord,
};
