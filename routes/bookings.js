const express = require("express");
const router = express.Router();
const Booking = require("../models/Booking");
const Car = require("../models/Car");
const Driver = require("../models/Driver");
const auth = require("../middleware/auth");
const Customer = require("../models/Customer");

// Create a new booking
router.post("/", auth, async (req, res) => {
    try {
        const {
            carId,
            driverId,
            tripType,
            cityName,
            startDate,
            endDate,
            meterReading,
            totalBill,
            advancePaid,
            discountPercentage,
            discountReference,
            customerName,
            cellNumber,
            careOf,
            idCardNumber,
            tripStartTime,
            tripDescription,
            driverPreference,
            customerLicenseNumber
        } = req.body;

        // Validate required fields
        if (!carId || !tripType || !startDate || !endDate || 
            !meterReading || !totalBill || !advancePaid || 
            !customerName || !cellNumber || !idCardNumber ||
            !tripStartTime || !driverPreference) {
            return res.status(400).json({ error: "All required fields must be provided" });
        }

        // Validate if car exists
        const car = await Car.findById(carId);
        if (!car) {
            return res.status(404).json({ error: "Car not found" });
        }

        // Validate driver if driver preference is 'driver'
        if (driverPreference === 'driver') {
            if (!driverId) {
                return res.status(400).json({ error: "Driver ID is required when driver preference is 'driver'" });
            }
            const driver = await Driver.findById(driverId);
            if (!driver) {
                return res.status(404).json({ error: "Driver not found" });
            }
        }

        // Check if the car is available for the selected dates
        const isCarAvailable = await Booking.checkAvailability(
            carId,
            new Date(startDate),
            new Date(endDate)
        );

        if (!isCarAvailable) {
            return res.status(400).json({ error: "Car is not available for selected dates" });
        }

        // Validate city name for out-of-city trips
        if (tripType === "outofcity" && !cityName) {
            return res.status(400).json({ error: "City name is required for out-of-city trips" });
        }

        // Find or create customer
        let customer = await Customer.findOne({
            $or: [
                { phoneNumber: cellNumber },
                { idCardNumber }
            ]
        });

        if (!customer) {
            customer = new Customer({
                fullName: customerName,
                phoneNumber: cellNumber,
                careOf: careOf,
                idCardNumber,
                bookingCount: 1,
                lastBookingDate: new Date()
            });
        } else {
            customer.bookingCount += 1;
            customer.lastBookingDate = new Date();
            if (customer.fullName !== customerName) {
                customer.fullName = customerName;
            }
            if (customer.careOf != careOf){
                customer.careOf = careOf;
            }
        }

        await customer.save();

        // Create new booking
        const newBooking = new Booking({
            carId,
            driverId: driverPreference === 'driver' ? driverId : undefined,
            tripType: tripType === "out-of-city" ? "outofcity" : "withincity",
            cityName: tripType === "out-of-city" ? cityName : undefined,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            meterReading: Number(meterReading),
            totalBill: Number(totalBill),
            advancePaid: Number(advancePaid),
            discountPercentage: Number(discountPercentage || 0),
            discountReference: discountPercentage > 0 ? discountReference : undefined,
            customerId: customer._id,
            bookedBy: req.user.id,
            status: 'active',
            tripStartTime,
            tripDescription,
            driverPreference,
            customerLicenseNumber: driverPreference === 'self' ? customerLicenseNumber : undefined
        });

        // Save the booking
        await newBooking.save();

        // Update driver availability if driver is assigned
        if (driverPreference === 'driver') {
            await Driver.findByIdAndUpdate(driverId, { 
                available: false 
            });
        }

        // Return the created booking
        res.status(201).json({
            message: "Booking created successfully",
            booking: {
                id: newBooking._id,
                carId: newBooking.carId,
                driverId: newBooking.driverId,
                startDate: newBooking.startDate,
                endDate: newBooking.endDate,
                totalBill: newBooking.totalBill,
                remainingBalance: newBooking.remainingBalance,
                customerName: newBooking.customerFullName,
                cellNumber: newBooking.customerCellPhone,
                idCardNumber: newBooking.idCardNumber,
                status: newBooking.status,
                tripStartTime: newBooking.tripStartTime,
                tripDescription: newBooking.tripDescription,
                driverPreference: newBooking.driverPreference,
                customerLicenseNumber: newBooking.customerLicenseNumber,
                customer: {
                    id: customer._id,
                    fullName: customer.fullName,
                    phoneNumber: customer.phoneNumber,
                    idCardNumber: customer.idCardNumber,
                    bookingCount: customer.bookingCount,
                    lastBookingDate: customer.lastBookingDate
                }
            }
        });

    } catch (error) {
        console.error("Booking creation error:", error);
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to create booking" });
    }
});

// Get all bookings with populated data
router.get("/", auth, async (req, res) => {
    try {
        const bookings = await Booking.find()
            .populate({
                path: 'carId',
                select: 'model year registrationNumber'
            })
            .populate({
                path: 'driverId',
                select: 'name'
            })
            .populate({
                path: 'customerId',
                select: 'fullName idCardNumber'
            })
            .sort({ createdAt: -1 });

        const formattedBookings = bookings.map(booking => ({
            id: booking._id,
            carModel: booking.carId.model,
            carYear: booking.carId.year,
            registrationNumber: booking.carId.registrationNumber,
            customerName: booking.customerId.fullName,
            customerIdCard: booking.customerId.idCardNumber,
            driverName: booking.driverId?.name || 'Self Drive',
            startDate: booking.startDate,
            endDate: booking.endDate,
            status: booking.status,
            tripType: booking.tripType,
            cityName: booking.cityName,
            totalBill: booking.totalBill,
            advancePaid: booking.advancePaid,
            remainingAmount: booking.totalBill - booking.advancePaid,
            discountPercentage: booking.discountPercentage,
            meterReading: booking.meterReading,
            tripStartTime: booking.tripStartTime,
            tripDescription: booking.tripDescription,
            driverPreference: booking.driverPreference,
            customerLicenseNumber: booking.customerLicenseNumber
        }));

        // Add filters if provided in query params
        const { status, startDate, endDate } = req.query;

        let filteredBookings = formattedBookings;

        if (status) {
            filteredBookings = filteredBookings.filter(booking => 
                booking.status.toLowerCase() === status.toLowerCase()
            );
        }

        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            
            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                filteredBookings = filteredBookings.filter(booking => 
                    booking.startDate >= start && booking.endDate <= end
                );
            }
        }

        res.json({
            bookings: filteredBookings
        });

    } catch (error) {
        console.error("Error fetching bookings:", error);
        res.status(500).json({ error: "Failed to fetch bookings" });
    }
});

// Get bookings by status
router.get("/status/:status", auth, async (req, res) => {
    try {
        const { status } = req.params;
        
        // Validate status
        const validStatuses = ['active', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: "Invalid status" });
        }

        // Find bookings by status and populate related data
        const bookings = await Booking.find({ status })
            .populate({
                path: 'carId',
                select: 'model year registrationNumber'
            })
            .populate({
                path: 'driverId',
                select: 'name'
            })
            .populate({
                path: 'customerId',
                select: 'fullName idCardNumber'
            })
            .sort({ startDate: -1 });

        // Format the response
        const formattedBookings = bookings.map(booking => ({
            id: booking._id,
            carModel: booking.carId.model,
            carYear: booking.carId.year,
            registrationNumber: booking.carId.registrationNumber,
            customerName: booking.customerId.fullName,
            customerIdCard: booking.customerId.idCardNumber,
            driverName: booking.driverId.name,
            startDate: booking.startDate,
            endDate: booking.endDate,
            status: booking.status,
            tripType: booking.tripType,
            cityName: booking.cityName,
            totalBill: booking.totalBill,
            advancePaid: booking.advancePaid,
            remainingAmount: booking.remainingBalance,
            startTime: booking.startTime,
        }));

        res.json( {bookings: formattedBookings});

    } catch (error) {
        console.error("Error fetching bookings by status:", error);
        res.status(500).json({ error: "Failed to fetch bookings" });
    }
});


// Get all active bookings for the authenticated user
router.get("/active", auth, async (req, res) => {
    try {
        // Find bookings with status 'active' for the current user
        const bookings = await Booking.find({ status: 'active', bookedBy: req.user.id })
            .populate({
                path: 'carId',
                select: 'model year registrationNumber'
            })
            .populate({
                path: 'driverId',
                select: 'name'
            })
            .populate({
                path: 'customerId',
                select: 'fullName idCardNumber'
            })
            .sort({ createdAt: -1 });

        const formattedBookings = bookings.map(booking => ({
            id: booking._id,
            carModel: booking.carId.model,
            carYear: booking.carId.year,
            registrationNumber: booking.carId.registrationNumber,
            customerName: booking.customerId.fullName,
            customerIdCard: booking.customerId.idCardNumber,
            driverName: booking.driverId?.name || 'Self Drive',
            startDate: booking.startDate,
            endDate: booking.endDate,
            status: booking.status,
            tripType: booking.tripType,
            cityName: booking.cityName,
            totalBill: booking.totalBill,
            advancePaid: booking.advancePaid,
            remainingAmount: booking.totalBill - booking.advancePaid,
            discountPercentage: booking.discountPercentage,
            meterReading: booking.meterReading,
            tripStartTime: booking.tripStartTime,
            tripDescription: booking.tripDescription,
            driverPreference: booking.driverPreference,
            customerLicenseNumber: booking.customerLicenseNumber
        }));

        res.json({ bookings: formattedBookings });
    } catch (error) {
        console.error("Error fetching active bookings:", error);
        res.status(500).json({ error: "Failed to fetch active bookings" });
    }
});

// Get detailed booking information by ID
router.get("/:bookingId/details", auth, async (req, res) => {
    try {
        const { bookingId } = req.params;

        // Find booking and populate all related data
        const booking = await Booking.findById(bookingId)
            .populate({
                path: 'carId',
                select: 'model year color registrationNumber chassisNumber engineNumber image variant'
            })
            .populate({
                path: 'driverId',
                select: 'name phone idNumber avatar'
            })
            .populate({
                path: 'customerId',
                select: 'fullName phoneNumber idCardNumber'
            })
            .populate({
                path: 'bookedBy',
                select: 'name'
            });

        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        const discountAmount = (booking.totalBill * (booking.discountPercentage || 0)) / 100;
        const discountedTotal = booking.totalBill - discountAmount;

        // Format the response
        const formattedBooking = {
            id: booking._id,
            status: booking.status,
            customer: {
                name: booking.customerId.fullName,
                phone: booking.customerId.phoneNumber,
                idCard: booking.customerId.idCardNumber,
            },
            car: {
                model: booking.carId.model,
                year: booking.carId.year,
                color: booking.carId.color,
                registrationNumber: booking.carId.registrationNumber,
                chassisNumber: booking.carId.chassisNumber,
                engineNumber: booking.carId.engineNumber,
                image: booking.carId.image || "/placeholder.svg?height=200&width=300",
                meterReading: booking.meterReading,
                variant: booking.carId.variant
            },
            driver: {
                name: booking?.driverId?.name || null,
                phone: booking?.driverId?.phone || null,
                idCard: booking?.driverId?.idNumber || null,
                image: booking?.driverId?.avatar || "/placeholder.svg?height=100&width=100",
            },
            trip: {
                type: booking.tripType === 'withincity' ? 'within-city' : 'out-of-city',
                city: booking.cityName || "",
                startDate: booking.startDate,
                endDate: booking.endDate,
                actualEndDate: booking.status === 'completed' ? booking.updatedAt : null,
                tripStartTime: booking.tripStartTime || "12:00",
                endTime: booking.endTime || null,
                description: booking.description,
            },
            billing: {
                totalAmount: booking.totalBill,
                advancePaid: booking.advancePaid,
                discount: booking.discountPercentage || 0,
                discountReference: booking.discountReference || "",
                discountAmount: discountAmount,
                discountedTotal: discountedTotal,
                remaining: discountedTotal - booking.advancePaid
            },
            createdAt: booking.createdAt,
            createdBy: booking.bookedBy.name,
            driverPreference: booking.driverPreference,
            customerLicenseNumber: booking.customerLicenseNumber,
            // Additional useful information
            updatedAt: booking.updatedAt,
            lastModifiedBy: booking.bookedBy.name // You might want to add a separate field for last modified by
        };

        res.json(formattedBooking);

    } catch (error) {
        console.error("Error fetching booking details:", error);
        if (error.kind === 'ObjectId') {
            return res.status(400).json({ error: "Invalid booking ID" });
        }
        res.status(500).json({ error: "Failed to fetch booking details" });
    }
});

// Get booking details for edit page
router.get("/:bookingId/edit", auth, async (req, res) => {
    try {
        const { bookingId } = req.params;

        // Find booking and populate necessary fields
        const booking = await Booking.findById(bookingId)
            .populate({
                path: 'carId',
                select: 'model year color registrationNumber'
            })
            .populate({
                path: 'customerId',
                select: 'fullName phoneNumber idCardNumber'
            });

        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Check if booking can be edited
        if (booking.status === 'completed' || booking.status === 'cancelled') {
            return res.status(400).json({ 
                error: "Cannot edit completed or cancelled bookings" 
            });
        }

        const discountAmount = (booking.totalBill * (booking.discountPercentage || 0)) / 100;
        const discountedTotal = booking.totalBill - discountAmount;

        // Format the response
        const formattedBooking = {
            id: booking._id,
            status: booking.status,
            customer: {
                id: booking.customerId._id,
                name: booking.customerId.fullName,
                phone: booking.customerId.phoneNumber,
                idCard: booking.customerId.idCardNumber,
            },
            car: {
                id: booking.carId._id,
                model: booking.carId.model,
                year: booking.carId.year,
                color: booking.carId.color,
                registrationNumber: booking.carId.registrationNumber,
                meterReading: booking.meterReading,
            },
            trip: {
                type: booking.tripType === 'withincity' ? 'within-city' : 'out-of-city',
                city: booking.cityName || "",
                startDate: booking.startDate,
                endDate: booking.endDate,
                startTime: booking.startTime || "12:00"
            },
            billing: {
                totalAmount: booking.totalBill,
                advancePaid: booking.advancePaid,
                discount: booking.discountPercentage || 0,
                discountReference: booking.discountReference || "",
                discountAmount: discountAmount,
                discountedTotal: discountedTotal,
                remaining: discountedTotal - booking.advancePaid
            }
        };

        res.json(formattedBooking);

    } catch (error) {
        console.error("Error fetching booking details for edit:", error);
        if (error.kind === 'ObjectId') {
            return res.status(400).json({ error: "Invalid booking ID" });
        }
        res.status(500).json({ error: "Failed to fetch booking details" });
    }
});

// Update booking
router.patch("/:bookingId", auth, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const {
            tripType,
            cityName,
            startDate,
            endDate,
            meterReading,
            totalBill,
            advancePaid,
            discountPercentage,
            discountReference,
            tripStartTime,
            tripDescription,
            driverPreference,
            driverId,
            customerLicenseNumber
        } = req.body;

        // Find booking
        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Check if booking can be edited
        if (booking.status !== 'active') {
            return res.status(400).json({ 
                error: "Only active bookings can be edited" 
            });
        }

        // Validate driver if changing to driver preference
        if (driverPreference === 'driver' && !driverId) {
            return res.status(400).json({ 
                error: "Driver ID is required when driver preference is 'driver'" 
            });
        }

        // Validate license number if changing to self-driving
        if (driverPreference === 'self' && !customerLicenseNumber) {
            return res.status(400).json({ 
                error: "License number is required when driver preference is 'self'" 
            });
        }

        // Update booking
        const updatedBooking = await Booking.findByIdAndUpdate(
            bookingId,
            {
                tripType: tripType === 'within-city' ? 'withincity' : 'outofcity',
                cityName: tripType === 'out-of-city' ? cityName : undefined,
                startDate: startDate || booking.startDate,
                endDate: endDate || booking.endDate,
                meterReading: meterReading || booking.meterReading,
                totalBill: totalBill || booking.totalBill,
                advancePaid: advancePaid || booking.advancePaid,
                discountPercentage: discountPercentage || booking.discountPercentage,
                discountReference: discountReference || booking.discountReference,
                tripStartTime: tripStartTime || booking.tripStartTime,
                tripDescription: tripDescription || booking.tripDescription,
                driverPreference: driverPreference || booking.driverPreference,
                driverId: driverPreference === 'driver' ? driverId : undefined,
                customerLicenseNumber: driverPreference === 'self' ? customerLicenseNumber : undefined
            },
            { new: true }
        ).populate([
            { path: 'carId', select: 'model year color registrationNumber' },
            { path: 'customerId', select: 'fullName phoneNumber idCardNumber' },
            { path: 'driverId', select: 'name' }
        ]);

        // Format and return updated booking
        const formattedBooking = {
            id: updatedBooking._id,
            status: updatedBooking.status,
            customer: {
                id: updatedBooking.customerId._id,
                name: updatedBooking.customerId.fullName,
                phone: updatedBooking.customerId.phoneNumber,
                idCard: updatedBooking.customerId.idCardNumber,
            },
            car: {
                id: updatedBooking.carId._id,
                model: updatedBooking.carId.model,
                year: updatedBooking.carId.year,
                color: updatedBooking.carId.color,
                registrationNumber: updatedBooking.carId.registrationNumber,
                meterReading: updatedBooking.meterReading,
            },
            trip: {
                type: updatedBooking.tripType === 'withincity' ? 'within-city' : 'out-of-city',
                city: updatedBooking.cityName || "",
                startDate: updatedBooking.startDate,
                endDate: updatedBooking.endDate,
                startTime: updatedBooking.tripStartTime,
                description: updatedBooking.tripDescription
            },
            driver: {
                preference: updatedBooking.driverPreference,
                name: updatedBooking.driverId?.name || 'Self Drive',
                licenseNumber: updatedBooking.customerLicenseNumber
            },
            billing: {
                totalAmount: updatedBooking.totalBill,
                advancePaid: updatedBooking.advancePaid,
                discount: updatedBooking.discountPercentage || 0,
                discountReference: updatedBooking.discountReference || "",
                remaining: updatedBooking.totalBill - updatedBooking.advancePaid
            }
        };

        res.json({
            message: "Booking updated successfully",
            booking: formattedBooking
        });

    } catch (error) {
        console.error("Error updating booking:", error);
        if (error.kind === 'ObjectId') {
            return res.status(400).json({ error: "Invalid booking ID" });
        }
        res.status(500).json({ error: "Failed to update booking" });
    }
});

// Cancel booking
router.patch("/:bookingId/cancel", auth, async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { cancellationReason } = req.body;

        // Find booking
        const booking = await Booking.findById(bookingId)
            .populate('driverId', 'name')
            .populate('carId', 'model registrationNumber');

        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Check if booking can be cancelled
        if (booking.status !== 'active') {
            return res.status(400).json({ 
                error: "Only active bookings can be cancelled" 
            });
        }

        // Update booking status
        booking.status = 'cancelled';
        booking.cancellationReason = cancellationReason || 'No reason provided';
        booking.cancelledAt = new Date();
        booking.cancelledBy = req.user.id;

        // Make driver available again
        if (booking.driverPreference === "driver"){
            await Driver.findByIdAndUpdate(booking.driverId._id, { 
                available: true 
            });    
        }

        await booking.save();

        // Calculate billing details
        const discountAmount = (booking.totalBill * (booking.discountPercentage || 0)) / 100;
        const discountedTotal = booking.totalBill - discountAmount;
        const remainingAmount = discountedTotal - booking.advancePaid;

        res.json({
            message: "Booking cancelled successfully",
            booking: {
                id: booking._id,
                status: booking.status,
                car: {
                    model: booking.carId.model,
                    registrationNumber: booking.carId.registrationNumber
                },
                driver: {
                    name: booking?.driverId?.name
                },
                cancellationDetails: {
                    reason: booking.cancellationReason,
                    cancelledAt: booking.cancelledAt,
                    cancelledBy: req.user.id
                },
                billing: {
                    totalAmount: booking.totalBill,
                    advancePaid: booking.advancePaid,
                    discount: booking.discountPercentage || 0,
                    discountAmount: discountAmount,
                    discountedTotal: discountedTotal,
                    remaining: remainingAmount,
                    refundAmount: booking.advancePaid // You might want to adjust refund logic
                }
            }
        });

    } catch (error) {
        console.error("Error cancelling booking:", error);
        res.status(500).json({ error: "Failed to cancel booking" });
    }
});

// End booking (Complete booking)
router.patch("/:bookingId/end", auth, async (req, res) => {
    try {
        const { bookingId } = req.params;
        let { 
            endTime,
            finalMeterReading,
            additionalCharges = 0,
            additionalChargesDescription = '',
            remainingPayment = 0
        } = req.body;

        // Convert ISO date string to HH:mm format
        const endDate = new Date(req.body.endTime);
        if (isNaN(endDate.getTime())) {
            return res.status(400).json({ error: "Invalid end time format" });
        }

        // Format to HH:mm
        endTime = endDate.toTimeString().slice(0, 5);


        // Validate required fields
        if (!endTime || !finalMeterReading) {
            return res.status(400).json({ 
                error: "End time and final meter reading are required" 
            });
        }

        // Find booking
        const booking = await Booking.findById(bookingId)
            .populate('driverId', 'name')
            .populate('carId', 'model registrationNumber')
            .populate('customerId', 'fullName phoneNumber');

        if (!booking) {
            return res.status(404).json({ error: "Booking not found" });
        }

        // Check if booking can be ended
        if (booking.status !== 'active') {
            return res.status(400).json({ 
                error: "Only active bookings can be ended" 
            });
        }

        // Validate meter reading
        if (finalMeterReading < booking.meterReading) {
            return res.status(400).json({ 
                error: "Final meter reading cannot be less than initial meter reading" 
            });
        }

        // Calculate final bill including additional charges
        const updatedTotalBill = booking.totalBill + Number(additionalCharges);
        const discountAmount = (updatedTotalBill * (booking.discountPercentage || 0)) / 100;
        const discountedTotal = updatedTotalBill - discountAmount;
        const finalRemainingAmount = discountedTotal - booking.advancePaid - Number(remainingPayment);

        // Update booking
        booking.status = 'completed';
        booking.endTime = endTime;
        booking.finalMeterReading = finalMeterReading;
        booking.totalBill = updatedTotalBill;
        booking.additionalCharges = additionalCharges;
        booking.additionalChargesDescription = additionalChargesDescription;
        booking.remainingPaymentReceived = remainingPayment;
        booking.completedAt = new Date();
        booking.completedBy = req.user.id;

        // Make driver available again
        if (booking.driverPreference === "driver"){
            await Driver.findByIdAndUpdate(booking.driverId._id, { 
                available: true 
            });
        }

        await booking.save();

        res.json({
            message: "Booking completed successfully",
            booking: {
                id: booking._id,
                status: booking.status,
                car: {
                    model: booking.carId.model,
                    registrationNumber: booking.carId.registrationNumber
                },
                driver: {
                    name: booking?.driverId?.name || "Self"
                },
                customer: {
                    name: booking.customerId.fullName,
                    phone: booking.customerId.phoneNumber
                },
                tripDetails: {
                    startDate: booking.startDate,
                    endDate: booking.endDate,
                    startTime: booking.startTime,
                    endTime: booking.endTime,
                    initialMeterReading: booking.meterReading,
                    finalMeterReading: booking.finalMeterReading,
                    totalKilometers: booking.finalMeterReading - booking.meterReading
                },
                billing: {
                    originalAmount: booking.totalBill - additionalCharges,
                    additionalCharges: additionalCharges,
                    additionalChargesDescription: additionalChargesDescription,
                    totalAmount: updatedTotalBill,
                    advancePaid: booking.advancePaid,
                    remainingPaymentReceived: remainingPayment,
                    discount: booking.discountPercentage || 0,
                    discountAmount: discountAmount,
                    discountedTotal: discountedTotal,
                    finalRemainingBalance: finalRemainingAmount
                },
                completionDetails: {
                    completedAt: booking.completedAt,
                    completedBy: req.user.id
                }
            }
        });

    } catch (error) {
        console.error("Error ending booking:", error);
        res.status(500).json({ error: "Failed to end booking" });
    }
});


module.exports = router; 